import type { DateOverride, TimeRange, WeeklyHours } from '../availability';
import { BookingStoreError, type LessonType, type LiveBooking, type StudioSettings } from './types';

export interface SettingsRow {
	timezone: string;
	min_notice_hours: number;
	max_advance_days: number;
	slot_increment_min: number;
	buffer_min: number;
	allow_same_day: boolean;
	cancel_cutoff_hours: number;
	cancellation_policy_text: string;
	admin_email: string | null;
}

export interface WeeklyHoursRow {
	weekday: number;
	start_time: string;
	end_time: string;
}

export interface DateOverrideRow {
	date: string;
	is_closed: boolean;
	note: string | null;
}

export interface DateOverrideRangeRow {
	date: string;
	start_time: string;
	end_time: string;
}

export interface LessonTypeRow {
	id: string;
	name: string;
	description: string;
	duration_min: number;
	price_cents: number;
	sort_order: number;
}

export interface LiveBookingRow {
	starts_at: string;
	ends_at: string;
	blocked_until: string;
}

/** Postgres `time` arrives as 'HH:mm:ss'; the app uses 'HH:mm'. */
const trimTime = (t: string) => t.slice(0, 5);

export function mapSettingsRow(row: SettingsRow): StudioSettings {
	return {
		timezone: row.timezone,
		minNoticeHours: row.min_notice_hours,
		maxAdvanceDays: row.max_advance_days,
		slotIncrementMin: row.slot_increment_min,
		bufferMin: row.buffer_min,
		allowSameDay: row.allow_same_day,
		cancelCutoffHours: row.cancel_cutoff_hours,
		cancellationPolicyText: row.cancellation_policy_text,
		adminEmail: row.admin_email
	};
}

export function mapWeeklyHoursRow(row: WeeklyHoursRow): WeeklyHours {
	return { weekday: row.weekday, start: trimTime(row.start_time), end: trimTime(row.end_time) };
}

export function mapOverrides(
	overrideRows: DateOverrideRow[],
	rangeRows: DateOverrideRangeRow[]
): DateOverride[] {
	const rangesByDate = new Map<string, TimeRange[]>();
	for (const r of rangeRows) {
		const list = rangesByDate.get(r.date) ?? [];
		list.push({ start: trimTime(r.start_time), end: trimTime(r.end_time) });
		rangesByDate.set(r.date, list);
	}
	return overrideRows
		.map((o) => ({
			date: o.date,
			isClosed: o.is_closed,
			ranges: (rangesByDate.get(o.date) ?? []).sort((a, b) => a.start.localeCompare(b.start))
		}))
		.sort((a, b) => a.date.localeCompare(b.date));
}

export function mapLessonTypeRow(row: LessonTypeRow): LessonType {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		durationMin: row.duration_min,
		priceCents: row.price_cents,
		sortOrder: row.sort_order
	};
}

export function mapLiveBookingRow(row: LiveBookingRow): LiveBooking {
	return {
		startsAt: new Date(row.starts_at),
		endsAt: new Date(row.ends_at),
		blockedUntil: new Date(row.blocked_until)
	};
}

/** Translates request_guest_booking SQLSTATEs into store errors; null when unrecognised. */
export function mapRpcError(error: { code?: string; message?: string }): BookingStoreError | null {
	switch (error.code) {
		case '23P01':
			return new BookingStoreError('slot_taken');
		case 'P0001':
			return new BookingStoreError('too_many_pending');
		case 'P0002':
			return new BookingStoreError('lesson_type_not_found');
		default:
			return null;
	}
}
