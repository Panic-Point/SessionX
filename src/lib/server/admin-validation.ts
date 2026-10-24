import { DateTime, IANAZone } from 'luxon';
import type { TimeRange, WeeklyHours } from './availability';
import type { DateOverrideWithNote, LessonTypeInput, StudioSettings } from './store/types';

export type Result<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SLOT_INCREMENTS = [5, 10, 15, 20, 30, 60];

const MSG_TIME = 'Use a time like 15:00.';
const MSG_ORDER = 'End time must be after start time.';
const MSG_OVERLAP = 'Times overlap.';

function finish<T>(errors: Record<string, string>, value: () => T): Result<T> {
	return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: value() };
}

/** Whole number from a raw form string; null when not an integer. */
function parseInteger(s: string | undefined): number | null {
	const t = (s ?? '').trim();
	return /^-?\d+$/.test(t) ? Number(t) : null;
}

function inRange(n: number | null, min: number, max: number): n is number {
	return n !== null && n >= min && n <= max;
}

function toMinutes(t: string): number {
	return Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
}

/** "35" | "35.5" | "35.50" -> cents; anything else -> null. */
export function dollarsToCents(s: string): number | null {
	const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s.trim());
	if (!m) return null;
	return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

export function validateSettings(form: Record<string, string | undefined>): Result<StudioSettings> {
	const errors: Record<string, string> = {};
	const timezone = (form.timezone ?? '').trim();
	if (!timezone || !IANAZone.isValidZone(timezone)) errors.timezone = 'Choose a valid time zone.';

	const minNotice = parseInteger(form.minNoticeHours);
	if (!inRange(minNotice, 0, 720)) errors.minNoticeHours = 'Enter a whole number from 0 to 720.';
	const cutoff = parseInteger(form.cancelCutoffHours);
	if (!inRange(cutoff, 0, 720)) errors.cancelCutoffHours = 'Enter a whole number from 0 to 720.';
	const maxAdvance = parseInteger(form.maxAdvanceDays);
	if (!inRange(maxAdvance, 1, 365)) errors.maxAdvanceDays = 'Enter a whole number from 1 to 365.';
	const increment = parseInteger(form.slotIncrementMin);
	if (increment === null || !SLOT_INCREMENTS.includes(increment)) {
		errors.slotIncrementMin = 'Choose a slot interval.';
	}
	const buffer = parseInteger(form.bufferMin);
	if (!inRange(buffer, 0, 120)) errors.bufferMin = 'Enter a whole number from 0 to 120.';

	const policy = (form.cancellationPolicyText ?? '').trim();
	if (policy.length > 2000)
		errors.cancellationPolicyText = 'Keep the policy under 2000 characters.';

	const email = (form.adminEmail ?? '').trim();
	if (email && !EMAIL_PATTERN.test(email)) errors.adminEmail = 'Enter a valid email address.';

	return finish(errors, () => ({
		timezone,
		minNoticeHours: minNotice!,
		maxAdvanceDays: maxAdvance!,
		slotIncrementMin: increment!,
		bufferMin: buffer!,
		allowSameDay: form.allowSameDay === 'on',
		cancelCutoffHours: cutoff!,
		cancellationPolicyText: policy,
		adminEmail: email || null
	}));
}

/** Format and order error for one range, or null when it is well formed. */
function rangeError(r: TimeRange): string | null {
	if (!TIME_PATTERN.test(r.start) || !TIME_PATTERN.test(r.end)) return MSG_TIME;
	if (toMinutes(r.end) <= toMinutes(r.start)) return MSG_ORDER;
	return null;
}

function anyOverlap(ranges: TimeRange[]): boolean {
	const sorted = [...ranges].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
	return sorted.some((r, i) => i > 0 && toMinutes(r.start) < toMinutes(sorted[i - 1].end));
}

export function validateWeeklyHours(
	rows: { weekday: string; start: string; end: string }[]
): Result<WeeklyHours[]> {
	const errors: Record<string, string> = {};
	const value: WeeklyHours[] = [];
	const byDay = new Map<number, TimeRange[]>();

	rows.forEach((row, i) => {
		const weekday = parseInteger(row.weekday);
		if (!inRange(weekday, 1, 7)) {
			errors[`row-${i}`] = 'Choose a weekday.';
			return;
		}
		const start = row.start.trim();
		const end = row.end.trim();
		const err = rangeError({ start, end });
		if (err) {
			errors[`row-${i}`] = err;
			return;
		}
		value.push({ weekday, start, end });
		byDay.set(weekday, [...(byDay.get(weekday) ?? []), { start, end }]);
	});

	for (const [weekday, ranges] of byDay) {
		if (anyOverlap(ranges)) errors[`weekday-${weekday}`] = MSG_OVERLAP;
	}
	return finish(errors, () => value);
}

export function validateOverride(form: {
	date: string;
	isClosed: boolean;
	note: string;
	ranges: { start: string; end: string }[];
}): Result<DateOverrideWithNote> {
	const errors: Record<string, string> = {};
	const date = form.date.trim();
	if (!DATE_PATTERN.test(date) || !DateTime.fromISO(date).isValid) errors.date = 'Choose a date.';

	const note = form.note.trim();
	if (note.length > 200) errors.note = 'Keep the note under 200 characters.';

	let ranges: TimeRange[] = [];
	if (!form.isClosed) {
		ranges = form.ranges.map((r) => ({ start: r.start.trim(), end: r.end.trim() }));
		if (ranges.length === 0) {
			errors.ranges = 'Add opening times or mark the day closed.';
		} else {
			const bad = ranges.map(rangeError).find((e) => e !== null);
			if (bad) errors.ranges = bad;
			else if (anyOverlap(ranges)) errors.ranges = MSG_OVERLAP;
		}
	}
	return finish(errors, () => ({ date, isClosed: form.isClosed, note, ranges }));
}

export function validateLessonType(
	form: Record<string, string | undefined>
): Result<LessonTypeInput> {
	const errors: Record<string, string> = {};
	const name = (form.name ?? '').trim();
	if (name.length < 1) errors.name = 'Enter a name.';
	else if (name.length > 100) errors.name = 'Keep the name under 100 characters.';

	const description = (form.description ?? '').trim();
	if (description.length > 500) errors.description = 'Keep the description under 500 characters.';

	const durationMin = parseInteger(form.durationMin);
	if (!inRange(durationMin, 5, 480)) errors.durationMin = 'Enter minutes from 5 to 480.';

	const priceCents = dollarsToCents(form.price ?? '');
	if (priceCents === null || priceCents > 100000) errors.price = 'Enter a price like 35 or 35.00.';

	const sortRaw = (form.sortOrder ?? '').trim();
	const sortOrder = sortRaw === '' ? 0 : parseInteger(sortRaw);
	if (sortOrder === null) errors.sortOrder = 'Enter a whole number.';

	return finish(errors, () => ({
		name,
		description,
		durationMin: durationMin!,
		priceCents: priceCents!,
		sortOrder: sortOrder!,
		active: form.active === 'on'
	}));
}
