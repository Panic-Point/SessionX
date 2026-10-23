import { DateTime } from 'luxon';

export interface WeeklyHours {
	/** ISO weekday: 1 = Monday ... 7 = Sunday */
	weekday: number;
	/** HH:mm, studio local time */
	start: string;
	end: string;
}

export interface TimeRange {
	start: string;
	end: string;
}

export interface DateOverride {
	/** yyyy-MM-dd */
	date: string;
	isClosed: boolean;
	/** When not closed, these replace the weekly hours for the date. */
	ranges: TimeRange[];
}

export interface BookingRules {
	timezone: string;
	minNoticeHours: number;
	maxAdvanceDays: number;
	slotIncrementMin: number;
	bufferMin: number;
	allowSameDay: boolean;
}

export interface Interval {
	start: Date;
	end: Date;
}

export interface SlotQuery {
	durationMin: number;
	/** yyyy-MM-dd in rules.timezone */
	fromDate: string;
	/** yyyy-MM-dd in rules.timezone, inclusive */
	toDate: string;
	now: Date;
}

/** Date (yyyy-MM-dd) → ascending ISO UTC start times. Every date in the range is present. */
export type SlotsByDate = Record<string, string[]>;

const MINUTE = 60_000;

export function getAvailableSlots(
	q: SlotQuery,
	rules: BookingRules,
	hours: WeeklyHours[],
	overrides: DateOverride[],
	busy: Interval[]
): SlotsByDate {
	const zone = rules.timezone;
	const now = DateTime.fromJSDate(q.now, { zone });
	const today = now.toISODate()!;
	const lastBookable = now.plus({ days: rules.maxAdvanceDays }).toISODate()!;
	const earliestStart = q.now.getTime() + rules.minNoticeHours * 60 * MINUTE;
	const durationMs = q.durationMin * MINUTE;
	const bufferMs = rules.bufferMin * MINUTE;
	const overridesByDate = new Map(overrides.map((o) => [o.date, o]));

	const result: SlotsByDate = {};
	const last = DateTime.fromISO(q.toDate, { zone });
	for (let day = DateTime.fromISO(q.fromDate, { zone }); day <= last; day = day.plus({ days: 1 })) {
		const date = day.toISODate()!;
		result[date] = [];

		if (date > lastBookable) continue;
		if (date === today && !rules.allowSameDay) continue;

		const override = overridesByDate.get(date);
		const windows = override
			? override.isClosed
				? []
				: override.ranges
			: hours.filter((h) => h.weekday === day.weekday);

		const starts = new Set<number>();
		for (const window of windows) {
			const windowEnd = wallTime(day, window.end)?.toMillis();
			if (windowEnd === undefined) continue;

			const [startHour, startMinute] = window.start.split(':').map(Number);
			for (let m = startHour * 60 + startMinute; ; m += rules.slotIncrementMin) {
				if (m >= 24 * 60) break;
				const candidate = wallTime(day, `${Math.floor(m / 60)}:${m % 60}`);
				if (!candidate) continue; // wall time skipped by a DST change
				const start = candidate.toMillis();
				if (start + durationMs > windowEnd) break;
				if (start < earliestStart) continue;
				const blockedUntil = start + durationMs + bufferMs;
				const conflicts = busy.some(
					(b) => start < b.end.getTime() + bufferMs && b.start.getTime() < blockedUntil
				);
				if (!conflicts) starts.add(start);
			}
		}

		result[date] = [...starts].sort((a, b) => a - b).map((ms) => new Date(ms).toISOString());
	}
	return result;
}

/** The given wall-clock time (H:mm) on `day`, or null if that time doesn't exist (DST gap). */
function wallTime(day: DateTime, hhmm: string): DateTime | null {
	const [hour, minute] = hhmm.split(':').map(Number);
	const dt = day.set({ hour, minute, second: 0, millisecond: 0 });
	return dt.hour === hour && dt.minute === minute ? dt : null;
}
