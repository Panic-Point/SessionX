import type { DateOverride, TimeRange, WeeklyHours } from '../availability';
import {
	AccountStoreError,
	BookingStoreError,
	type Account,
	type AccountRole,
	type AccountWithStudents,
	type AdminBooking,
	type AdminLessonType,
	type BookingStatus,
	type DateOverrideWithNote,
	type LessonType,
	type LiveBooking,
	type Student,
	type StudentPrice,
	type StudioSettings
} from './types';

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
	gcal_write_calendar_id: string | null;
	gcal_busy_calendar_ids: string[];
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

export interface AccountRow {
	id: string;
	name: string;
	email: string;
	role: AccountRole;
}

export interface AdminLessonTypeRow extends LessonTypeRow {
	active: boolean;
}

/** Shape returned by the bookings select with students/accounts and lesson_types embeds. */
export interface AdminBookingRow {
	id: string;
	status: BookingStatus;
	starts_at: string;
	ends_at: string;
	price_cents: number;
	paid_at: string | null;
	note: string;
	decline_reason: string | null;
	late_cancel: boolean;
	manage_token: string;
	gcal_event_id: string | null;
	lesson_types: { name: string; duration_min: number } | null;
	students: { name: string; accounts: { name: string; email: string } | null } | null;
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
		adminEmail: row.admin_email,
		gcalWriteCalendarId: row.gcal_write_calendar_id,
		gcalBusyCalendarIds: row.gcal_busy_calendar_ids
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

export function mapAccountRow(row: AccountRow): Account {
	return { id: row.id, name: row.name, email: row.email, role: row.role };
}

export function mapAdminLessonTypeRow(row: AdminLessonTypeRow): AdminLessonType {
	return { ...mapLessonTypeRow(row), active: row.active };
}

export function mapAdminBookingRow(row: AdminBookingRow): AdminBooking {
	const startsAt = new Date(row.starts_at);
	const endsAt = new Date(row.ends_at);
	return {
		id: row.id,
		status: row.status,
		startsAt,
		endsAt,
		lessonTypeName: row.lesson_types?.name ?? '',
		// The booked length, not the lesson type's current one, which the admin may since have changed.
		durationMin: Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000),
		studentName: row.students?.name ?? '',
		accountName: row.students?.accounts?.name ?? '',
		accountEmail: row.students?.accounts?.email ?? '',
		priceCents: row.price_cents,
		paidAt: row.paid_at ? new Date(row.paid_at) : null,
		note: row.note,
		declineReason: row.decline_reason,
		lateCancel: row.late_cancel,
		manageToken: row.manage_token,
		gcalEventId: row.gcal_event_id
	};
}

export function mapOverridesWithNotes(
	overrideRows: DateOverrideRow[],
	rangeRows: DateOverrideRangeRow[]
): DateOverrideWithNote[] {
	const notes = new Map(overrideRows.map((o) => [o.date, o.note ?? '']));
	return mapOverrides(overrideRows, rangeRows).map((o) => ({
		...o,
		note: notes.get(o.date) ?? ''
	}));
}

export interface StudentRow {
	id: string;
	account_id: string;
	name: string;
	notes: string;
}

export interface StudentPriceRow {
	student_id: string;
	lesson_type_id: string;
	price_cents: number;
}

/** Accounts select with students and their student_prices embedded. */
export interface AccountWithStudentsRow extends AccountRow {
	admin_notes: string;
	students: (StudentRow & { student_prices: StudentPriceRow[] })[];
}

export function mapStudentRow(row: StudentRow): Student {
	return { id: row.id, accountId: row.account_id, name: row.name, notes: row.notes };
}

export function mapStudentPriceRow(row: StudentPriceRow): StudentPrice {
	return {
		studentId: row.student_id,
		lessonTypeId: row.lesson_type_id,
		priceCents: row.price_cents
	};
}

export function mapAccountWithStudentsRow(row: AccountWithStudentsRow): AccountWithStudents {
	return {
		...mapAccountRow(row),
		adminNotes: row.admin_notes,
		students: row.students
			.map((s) => ({ ...mapStudentRow(s), prices: s.student_prices.map(mapStudentPriceRow) }))
			.sort((a, b) => a.name.localeCompare(b.name))
	};
}

/**
 * Translates request_account_booking / cancel_booking / student-write SQLSTATEs into store
 * errors; null when unrecognised. 22P02 (malformed uuid) and 23503 (unknown foreign key) are treated as not found.
 */
export function mapAccountRpcError(error: {
	code?: string;
	message?: string;
}): AccountStoreError | BookingStoreError | null {
	switch (error.code) {
		case 'P0003':
		case 'P0004':
		case '22P02':
		case '23503':
			return new AccountStoreError('not_found');
		case 'P0005':
			return new AccountStoreError('not_cancellable');
		case '23505':
			return new AccountStoreError('duplicate_student');
		default:
			return mapRpcError(error);
	}
}
