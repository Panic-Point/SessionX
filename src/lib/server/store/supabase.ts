import { createClient } from '@supabase/supabase-js';
import type { DateOverride, WeeklyHours } from '../availability';
import {
	mapAccountRow,
	mapAccountRpcError,
	mapAccountWithStudentsRow,
	mapAdminBookingRow,
	mapAdminLessonTypeRow,
	mapLessonSeriesRow,
	mapLessonTypeRow,
	mapLiveBookingRow,
	mapOverrides,
	mapOverridesWithNotes,
	mapRpcError,
	mapSeriesRpcError,
	mapSettingsRow,
	mapStudentPriceRow,
	mapStudentRow,
	mapWeeklyHoursRow,
	toPasswordTokenRow,
	type AccountRow,
	type AccountWithStudentsRow,
	type AdminBookingRow,
	type AdminLessonTypeRow,
	type DateOverrideRangeRow,
	type DateOverrideRow,
	type LessonSeriesRow,
	type LessonTypeRow,
	type LiveBookingRow,
	type SettingsRow,
	type StudentPriceRow,
	type StudentRow,
	type WeeklyHoursRow
} from './supabase-mappers';
import {
	AccountStoreError,
	AdminStoreError,
	type Account,
	type AccountBookingInput,
	type AccountWithStudents,
	type AppStore,
	type CancelTarget,
	type AdminBooking,
	type AdminLessonType,
	type BookingFilter,
	type DateRange,
	type BookingStatus,
	type BookingSummary,
	type CreatedBooking,
	type DateOverrideWithNote,
	type GuestBookingInput,
	type LessonSeries,
	type LessonType,
	type LessonTypeInput,
	type LiveBooking,
	type OccurrenceResult,
	type PasswordTokenData,
	type SeriesInput,
	type Student,
	type StudentPrice,
	type StudioSettings
} from './types';

function fail(context: string, error: { message?: string }): never {
	throw new Error(`${context}: ${error.message ?? 'unknown error'}`);
}

interface BookingByTokenRow {
	status: BookingStatus;
	starts_at: string;
	ends_at: string;
	price_cents: number;
	note: string;
	lesson_types: { name: string } | null;
	students: { name: string } | null;
}

interface RpcOccurrenceRow {
	starts_at: string;
	booking_id: string | null;
}

const mapOccurrences = (rows: RpcOccurrenceRow[]): OccurrenceResult[] =>
	rows
		.map((r) => ({ startsAt: new Date(r.starts_at), bookingId: r.booking_id }))
		.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

interface RpcBookingRow {
	booking_id: string;
	manage_token: string;
	price_cents: number;
	starts_at: string;
	ends_at: string;
}

const ACCOUNT_COLUMNS = 'id, name, email, role';
const LESSON_TYPE_COLUMNS = 'id, name, description, duration_min, price_cents, sort_order, active';
const BOOKING_COLUMNS =
	'id, status, starts_at, ends_at, price_cents, paid_at, note, decline_reason, late_cancel, manage_token, gcal_event_id, lesson_types(name, duration_min), students(name, accounts(name, email)), lesson_series(id, weekday, start_time, interval_weeks)';
const SERIES_COLUMNS =
	'id, student_id, lesson_type_id, weekday, start_time, interval_weeks, starts_on, ends_on, occurrence_count, price_cents, note, materialized_through, created_at, ended_at, lesson_types(name, duration_min), students(name, account_id, accounts(name, email))';
// !inner so that filtering on students.account_id drops other accounts' series.
const OWNED_SERIES_COLUMNS = SERIES_COLUMNS.replace('students(', 'students!inner(');

const STUDENT_COLUMNS = 'id, account_id, name, notes';
const ACCOUNT_WITH_STUDENTS_COLUMNS = `${ACCOUNT_COLUMNS}, admin_notes, students(${STUDENT_COLUMNS}, student_prices(student_id, lesson_type_id, price_cents))`;
// !inner so that filtering on students.account_id drops other accounts' bookings.
const OWNED_BOOKING_COLUMNS = BOOKING_COLUMNS.replace('students(', 'students!inner(');

const lessonTypeColumns = (input: LessonTypeInput) => ({
	name: input.name,
	description: input.description,
	duration_min: input.durationMin,
	price_cents: input.priceCents,
	sort_order: input.sortOrder,
	active: input.active
});

/** BookingStore, AdminStore and AccountStore backed by Supabase. Uses the service-role key, so server-side only. */
export function createSupabaseBookingStore(url: string, serviceRoleKey: string): AppStore {
	const db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

	async function getAdminBooking(id: string): Promise<AdminBooking | null> {
		const { data, error } = await db
			.from('bookings')
			.select(BOOKING_COLUMNS)
			.eq('id', id)
			.maybeSingle();
		if (error) fail('getBooking', error);
		return data ? mapAdminBookingRow(data as unknown as AdminBookingRow) : null;
	}

	const isMalformedId = (error: { code?: string }) => error.code === '22P02';

	async function getLessonSeries(id: string): Promise<LessonSeries | null> {
		const { data, error } = await db
			.from('lesson_series')
			.select(SERIES_COLUMNS)
			.eq('id', id)
			.maybeSingle();
		if (error) {
			if (isMalformedId(error)) return null;
			fail('getSeries', error);
		}
		return data ? mapLessonSeriesRow(data as unknown as LessonSeriesRow) : null;
	}

	function failSeries(context: string, error: { code?: string; message?: string }): never {
		throw mapSeriesRpcError(error) ?? new Error(`${context}: ${error.message ?? 'unknown error'}`);
	}

	/** Throws the mapped store error, or a generic Error carrying the context. */
	function failAccount(context: string, error: { code?: string; message?: string }): never {
		throw mapAccountRpcError(error) ?? new Error(`${context}: ${error.message ?? 'unknown error'}`);
	}

	return {
		async getSettings(): Promise<StudioSettings> {
			const { data, error } = await db
				.from('settings')
				.select(
					'timezone, min_notice_hours, max_advance_days, slot_increment_min, buffer_min, allow_same_day, cancel_cutoff_hours, cancellation_policy_text, admin_email, gcal_write_calendar_id, gcal_busy_calendar_ids'
				)
				.single();
			if (error) fail('getSettings', error);
			return mapSettingsRow(data as SettingsRow);
		},

		async getWeeklyHours(): Promise<WeeklyHours[]> {
			const { data, error } = await db
				.from('weekly_hours')
				.select('weekday, start_time, end_time')
				.order('weekday')
				.order('start_time');
			if (error) fail('getWeeklyHours', error);
			return (data as WeeklyHoursRow[]).map(mapWeeklyHoursRow);
		},

		async getDateOverrides(fromDate: string, toDate: string): Promise<DateOverride[]> {
			const [overrides, ranges] = await Promise.all([
				db
					.from('date_overrides')
					.select('date, is_closed, note')
					.gte('date', fromDate)
					.lte('date', toDate),
				db
					.from('date_override_ranges')
					.select('date, start_time, end_time')
					.gte('date', fromDate)
					.lte('date', toDate)
			]);
			if (overrides.error) fail('getDateOverrides', overrides.error);
			if (ranges.error) fail('getDateOverrides', ranges.error);
			return mapOverrides(
				overrides.data as DateOverrideRow[],
				ranges.data as DateOverrideRangeRow[]
			);
		},

		async getActiveLessonTypes(): Promise<LessonType[]> {
			const { data, error } = await db
				.from('lesson_types')
				.select('id, name, description, duration_min, price_cents, sort_order')
				.eq('active', true)
				.order('sort_order');
			if (error) fail('getActiveLessonTypes', error);
			return (data as LessonTypeRow[]).map(mapLessonTypeRow);
		},

		async getLiveBookings(from: Date, to: Date): Promise<LiveBooking[]> {
			const { data, error } = await db
				.from('bookings')
				.select('starts_at, ends_at, blocked_until')
				.in('status', ['pending', 'approved'])
				.lt('starts_at', to.toISOString())
				.gt('blocked_until', from.toISOString());
			if (error) fail('getLiveBookings', error);
			return (data as LiveBookingRow[]).map(mapLiveBookingRow);
		},

		// `now` is ignored: the database clock is authoritative for the pending-request check.
		async requestGuestBooking(input: GuestBookingInput): Promise<CreatedBooking> {
			const { data, error } = await db.rpc('request_guest_booking', {
				p_email: input.email,
				p_account_name: input.accountName,
				p_student_name: input.studentName,
				p_lesson_type_id: input.lessonTypeId,
				p_starts_at: input.startsAt.toISOString(),
				p_note: input.note
			});
			if (error) throw mapRpcError(error) ?? new Error(`requestGuestBooking: ${error.message}`);
			const row = (data as RpcBookingRow[] | null)?.[0];
			if (!row) throw new Error('requestGuestBooking: no row returned');
			return {
				bookingId: row.booking_id,
				manageToken: row.manage_token,
				priceCents: row.price_cents,
				startsAt: new Date(row.starts_at),
				endsAt: new Date(row.ends_at)
			};
		},

		async getBookingByManageToken(token: string): Promise<BookingSummary | null> {
			const { data, error } = await db
				.from('bookings')
				.select('status, starts_at, ends_at, price_cents, note, lesson_types(name), students(name)')
				.eq('manage_token', token)
				.maybeSingle();
			if (error) fail('getBookingByManageToken', error);
			if (!data) return null;
			const row = data as unknown as BookingByTokenRow;
			return {
				status: row.status,
				startsAt: new Date(row.starts_at),
				endsAt: new Date(row.ends_at),
				lessonTypeName: row.lesson_types?.name ?? '',
				studentName: row.students?.name ?? '',
				priceCents: row.price_cents,
				note: row.note
			};
		},

		// ---- AdminStore ----

		async findAccountByEmail(email: string): Promise<Account | null> {
			const { data, error } = await db
				.from('accounts')
				.select(ACCOUNT_COLUMNS)
				.eq('email', email.trim().toLowerCase())
				.maybeSingle();
			if (error) fail('findAccountByEmail', error);
			return data ? mapAccountRow(data as AccountRow) : null;
		},

		async findAccountById(id: string): Promise<Account | null> {
			const { data, error } = await db
				.from('accounts')
				.select(ACCOUNT_COLUMNS)
				.eq('id', id)
				.maybeSingle();
			if (error) fail('findAccountById', error);
			return data ? mapAccountRow(data as AccountRow) : null;
		},

		async createLoginToken(accountId: string, tokenHash: string, expiresAt: Date): Promise<void> {
			const { error } = await db.from('login_tokens').insert({
				token_hash: tokenHash,
				account_id: accountId,
				expires_at: expiresAt.toISOString()
			});
			if (error) fail('createLoginToken', error);
		},

		async consumeLoginToken(tokenHash: string, now: Date): Promise<string | null> {
			const { data, error } = await db
				.from('login_tokens')
				.update({ used_at: now.toISOString() })
				.eq('token_hash', tokenHash)
				.is('used_at', null)
				.gt('expires_at', now.toISOString())
				.select('account_id');
			if (error) fail('consumeLoginToken', error);
			return (data as { account_id: string }[])[0]?.account_id ?? null;
		},

		async getPasswordHash(accountId: string): Promise<string | null> {
			const { data, error } = await db
				.from('accounts')
				.select('password_hash')
				.eq('id', accountId)
				.maybeSingle();
			if (error) fail('getPasswordHash', error);
			return (data as { password_hash: string | null } | null)?.password_hash ?? null;
		},

		async setPasswordHash(accountId: string, passwordHash: string): Promise<void> {
			const { data, error } = await db
				.from('accounts')
				.update({ password_hash: passwordHash })
				.eq('id', accountId)
				.select('id');
			if (error) fail('setPasswordHash', error);
			if ((data as unknown[]).length === 0) throw new AdminStoreError('not_found');
		},

		async createPasswordToken(
			tokenHash: string,
			data: PasswordTokenData,
			expiresAt: Date
		): Promise<void> {
			const { error } = await db
				.from('password_tokens')
				.insert(toPasswordTokenRow(tokenHash, data, expiresAt));
			if (error) fail('createPasswordToken', error);
		},

		async completeRegistration(tokenHash: string, now: Date): Promise<string | null> {
			const { data, error } = await db.rpc('complete_registration', {
				p_token_hash: tokenHash,
				p_now: now.toISOString()
			});
			if (error) fail('completeRegistration', error);
			return (data as string | null) ?? null;
		},

		async completePasswordReset(
			tokenHash: string,
			passwordHash: string,
			now: Date
		): Promise<string | null> {
			const { data, error } = await db.rpc('complete_password_reset', {
				p_token_hash: tokenHash,
				p_password_hash: passwordHash,
				p_now: now.toISOString()
			});
			if (error) fail('completePasswordReset', error);
			return (data as string | null) ?? null;
		},

		async countPasswordFailures(email: string, since: Date): Promise<number> {
			const { count, error } = await db
				.from('password_failures')
				.select('id', { count: 'exact', head: true })
				.eq('email', email.trim().toLowerCase())
				.gt('failed_at', since.toISOString());
			if (error) fail('countPasswordFailures', error);
			return count ?? 0;
		},

		async recordPasswordFailure(email: string, failedAt: Date): Promise<void> {
			const { error } = await db
				.from('password_failures')
				.insert({ email: email.trim().toLowerCase(), failed_at: failedAt.toISOString() });
			if (error) fail('recordPasswordFailure', error);
			// Housekeeping: rows only matter for the 15-minute lockout window.
			const dayAgo = new Date(failedAt.getTime() - 24 * 60 * 60 * 1000);
			const pruned = await db
				.from('password_failures')
				.delete()
				.lt('failed_at', dayAgo.toISOString());
			if (pruned.error) console.error('Failed to prune password_failures', pruned.error.message);
		},

		async clearPasswordFailures(email: string): Promise<void> {
			const { error } = await db
				.from('password_failures')
				.delete()
				.eq('email', email.trim().toLowerCase());
			if (error) fail('clearPasswordFailures', error);
		},

		async listBookings(filter: BookingFilter): Promise<AdminBooking[]> {
			let query = db
				.from('bookings')
				.select(BOOKING_COLUMNS)
				.in('status', filter.statuses)
				.order('starts_at', { ascending: filter.order === 'asc' });
			if (filter.from) query = query.gte('starts_at', filter.from.toISOString());
			if (filter.to) query = query.lt('starts_at', filter.to.toISOString());
			if (filter.unpaidOnly) query = query.is('paid_at', null);
			if (filter.lateCancelOnly) query = query.eq('late_cancel', true);
			const { data, error } = await query;
			if (error) fail('listBookings', error);
			return (data as unknown as AdminBookingRow[]).map(mapAdminBookingRow);
		},

		async getBooking(id: string): Promise<AdminBooking | null> {
			return getAdminBooking(id);
		},

		async decideBooking(
			id: string,
			decision: 'approved' | 'declined',
			reason: string | null,
			now: Date
		): Promise<AdminBooking> {
			let update = db
				.from('bookings')
				.update({
					status: decision,
					decided_at: now.toISOString(),
					decline_reason: decision === 'declined' ? reason : null
				})
				.eq('id', id)
				.eq('status', 'pending');
			if (decision === 'approved') update = update.gt('starts_at', now.toISOString());
			const { data, error } = await update.select(BOOKING_COLUMNS);
			if (error) fail('decideBooking', error);
			const row = (data as unknown as AdminBookingRow[])[0];
			if (row) return mapAdminBookingRow(row);

			const existing = await getAdminBooking(id);
			if (!existing) throw new AdminStoreError('not_found');
			if (existing.status !== 'pending') throw new AdminStoreError('not_pending');
			throw new AdminStoreError('in_past');
		},

		async setPaid(id: string, paidAt: Date | null): Promise<AdminBooking> {
			const { data, error } = await db
				.from('bookings')
				.update({ paid_at: paidAt ? paidAt.toISOString() : null })
				.eq('id', id)
				.select(BOOKING_COLUMNS);
			if (error) fail('setPaid', error);
			const row = (data as unknown as AdminBookingRow[])[0];
			if (!row) throw new AdminStoreError('not_found');
			return mapAdminBookingRow(row);
		},

		async updateSettings(settings: StudioSettings): Promise<void> {
			const { error } = await db
				.from('settings')
				.update({
					timezone: settings.timezone,
					min_notice_hours: settings.minNoticeHours,
					max_advance_days: settings.maxAdvanceDays,
					slot_increment_min: settings.slotIncrementMin,
					buffer_min: settings.bufferMin,
					allow_same_day: settings.allowSameDay,
					cancel_cutoff_hours: settings.cancelCutoffHours,
					cancellation_policy_text: settings.cancellationPolicyText,
					admin_email: settings.adminEmail,
					gcal_write_calendar_id: settings.gcalWriteCalendarId,
					gcal_busy_calendar_ids: settings.gcalBusyCalendarIds,
					updated_at: new Date().toISOString()
				})
				.eq('id', true);
			if (error) fail('updateSettings', error);
		},

		async setCalendarEventId(bookingId: string, eventId: string | null): Promise<void> {
			const { data, error } = await db
				.from('bookings')
				.update({ gcal_event_id: eventId })
				.eq('id', bookingId)
				.select('id');
			if (error) {
				if (isMalformedId(error)) throw new AdminStoreError('not_found');
				fail('setCalendarEventId', error);
			}
			if (!data || data.length === 0) throw new AdminStoreError('not_found');
		},

		async expirePendingBookings(now: Date): Promise<number> {
			const { data, error } = await db
				.from('bookings')
				.update({ status: 'expired' })
				.eq('status', 'pending')
				.lte('starts_at', now.toISOString())
				.select('id');
			if (error) fail('expirePendingBookings', error);
			return data?.length ?? 0;
		},

		async replaceWeeklyHours(hours: WeeklyHours[]): Promise<void> {
			const { error } = await db.rpc('replace_weekly_hours', { p_hours: hours });
			if (error) fail('replaceWeeklyHours', error);
		},

		async listDateOverrides(fromDate: string): Promise<DateOverrideWithNote[]> {
			const [overrides, ranges] = await Promise.all([
				db.from('date_overrides').select('date, is_closed, note').gte('date', fromDate),
				db.from('date_override_ranges').select('date, start_time, end_time').gte('date', fromDate)
			]);
			if (overrides.error) fail('listDateOverrides', overrides.error);
			if (ranges.error) fail('listDateOverrides', ranges.error);
			return mapOverridesWithNotes(
				overrides.data as DateOverrideRow[],
				ranges.data as DateOverrideRangeRow[]
			);
		},

		async saveDateOverride(override: DateOverrideWithNote): Promise<void> {
			const { error } = await db.rpc('save_date_override', {
				p_date: override.date,
				p_is_closed: override.isClosed,
				p_note: override.note,
				p_ranges: override.ranges
			});
			if (error) fail('saveDateOverride', error);
		},

		async deleteDateOverride(date: string): Promise<void> {
			// Ranges go with it (ON DELETE CASCADE).
			const { error } = await db.from('date_overrides').delete().eq('date', date);
			if (error) fail('deleteDateOverride', error);
		},

		async listAllLessonTypes(): Promise<AdminLessonType[]> {
			const { data, error } = await db
				.from('lesson_types')
				.select(LESSON_TYPE_COLUMNS)
				.order('sort_order')
				.order('name');
			if (error) fail('listAllLessonTypes', error);
			return (data as AdminLessonTypeRow[]).map(mapAdminLessonTypeRow);
		},

		async createLessonType(input: LessonTypeInput): Promise<AdminLessonType> {
			const { data, error } = await db
				.from('lesson_types')
				.insert(lessonTypeColumns(input))
				.select(LESSON_TYPE_COLUMNS)
				.single();
			if (error) fail('createLessonType', error);
			return mapAdminLessonTypeRow(data as AdminLessonTypeRow);
		},

		async updateLessonType(id: string, input: LessonTypeInput): Promise<AdminLessonType> {
			const { data, error } = await db
				.from('lesson_types')
				.update(lessonTypeColumns(input))
				.eq('id', id)
				.select(LESSON_TYPE_COLUMNS);
			if (error) fail('updateLessonType', error);
			const row = (data as AdminLessonTypeRow[])[0];
			if (!row) throw new AdminStoreError('not_found');
			return mapAdminLessonTypeRow(row);
		},

		// ---- AccountStore ----

		async listStudents(accountId: string): Promise<Student[]> {
			const { data, error } = await db
				.from('students')
				.select(STUDENT_COLUMNS)
				.eq('account_id', accountId)
				.order('name');
			if (error) {
				if (isMalformedId(error)) return [];
				fail('listStudents', error);
			}
			return (data as StudentRow[]).map(mapStudentRow);
		},

		async addStudent(accountId: string, name: string): Promise<Student> {
			const { data, error } = await db
				.from('students')
				.insert({ account_id: accountId, name: name.trim() })
				.select(STUDENT_COLUMNS)
				.single();
			if (error) failAccount('addStudent', error);
			return mapStudentRow(data as StudentRow);
		},

		async renameStudent(accountId: string, studentId: string, name: string): Promise<Student> {
			const { data, error } = await db
				.from('students')
				.update({ name: name.trim() })
				.eq('id', studentId)
				.eq('account_id', accountId)
				.select(STUDENT_COLUMNS);
			if (error) failAccount('renameStudent', error);
			const row = (data as StudentRow[])[0];
			if (!row) throw new AccountStoreError('not_found');
			return mapStudentRow(row);
		},

		async listStudentPrices(studentIds: string[]): Promise<StudentPrice[]> {
			if (studentIds.length === 0) return [];
			const { data, error } = await db
				.from('student_prices')
				.select('student_id, lesson_type_id, price_cents')
				.in('student_id', studentIds);
			if (error) {
				if (isMalformedId(error)) return [];
				fail('listStudentPrices', error);
			}
			return (data as StudentPriceRow[]).map(mapStudentPriceRow);
		},

		async listAccountBookings(accountId: string, range: DateRange = {}): Promise<AdminBooking[]> {
			let query = db
				.from('bookings')
				.select(OWNED_BOOKING_COLUMNS)
				.eq('students.account_id', accountId)
				.order('starts_at', { ascending: false });
			if (range.from) query = query.gte('starts_at', range.from.toISOString());
			if (range.to) query = query.lt('starts_at', range.to.toISOString());
			const { data, error } = await query;
			if (error) {
				if (isMalformedId(error)) return [];
				fail('listAccountBookings', error);
			}
			return (data as unknown as AdminBookingRow[]).map(mapAdminBookingRow);
		},

		async requestAccountBooking(input: AccountBookingInput): Promise<CreatedBooking> {
			// The database clock is authoritative for the pending-request check.
			const { data, error } = await db.rpc('request_account_booking', {
				p_account_id: input.accountId,
				p_student_id: input.studentId,
				p_lesson_type_id: input.lessonTypeId,
				p_starts_at: input.startsAt.toISOString(),
				p_note: input.note
			});
			if (error) failAccount('requestAccountBooking', error);
			const row = (data as RpcBookingRow[] | null)?.[0];
			if (!row) throw new Error('requestAccountBooking: no row returned');
			return {
				bookingId: row.booking_id,
				manageToken: row.manage_token,
				priceCents: row.price_cents,
				startsAt: new Date(row.starts_at),
				endsAt: new Date(row.ends_at)
			};
		},

		async getBookingByTarget(target: CancelTarget): Promise<AdminBooking | null> {
			const query =
				target.kind === 'token'
					? db.from('bookings').select(BOOKING_COLUMNS).eq('manage_token', target.manageToken)
					: db
							.from('bookings')
							.select(OWNED_BOOKING_COLUMNS)
							.eq('id', target.bookingId)
							.eq('students.account_id', target.accountId);
			const { data, error } = await query.maybeSingle();
			if (error) {
				if (isMalformedId(error)) return null;
				fail('getBookingByTarget', error);
			}
			return data ? mapAdminBookingRow(data as unknown as AdminBookingRow) : null;
		},

		async cancelBooking(
			target: CancelTarget,
			lateCancel: boolean,
			now: Date
		): Promise<AdminBooking> {
			const { data, error } = await db.rpc('cancel_booking', {
				p_booking_id: target.kind === 'account' ? target.bookingId : null,
				p_account_id: target.kind === 'account' ? target.accountId : null,
				p_manage_token: target.kind === 'token' ? target.manageToken : null,
				p_late: lateCancel,
				p_now: now.toISOString()
			});
			if (error) failAccount('cancelBooking', error);
			// The RPC returns only the id; re-read the full booking.
			const booking = await getAdminBooking(data as string);
			if (!booking) throw new AccountStoreError('not_found');
			return booking;
		},

		async listAccounts(): Promise<AccountWithStudents[]> {
			const { data, error } = await db
				.from('accounts')
				.select(ACCOUNT_WITH_STUDENTS_COLUMNS)
				.order('name');
			if (error) fail('listAccounts', error);
			return (data as unknown as AccountWithStudentsRow[]).map(mapAccountWithStudentsRow);
		},

		async getAccount(accountId: string): Promise<AccountWithStudents | null> {
			const { data, error } = await db
				.from('accounts')
				.select(ACCOUNT_WITH_STUDENTS_COLUMNS)
				.eq('id', accountId)
				.maybeSingle();
			if (error) {
				if (isMalformedId(error)) return null;
				fail('getAccount', error);
			}
			return data ? mapAccountWithStudentsRow(data as unknown as AccountWithStudentsRow) : null;
		},

		async setStudentPrice(
			studentId: string,
			lessonTypeId: string,
			priceCents: number | null
		): Promise<void> {
			// Both ids must exist even when removing, matching the memory store. An unknown id
			// surfaces as 23503 (upsert) or an empty lookup (delete); malformed ids as 22P02.
			const [student, lessonType] = await Promise.all([
				db.from('students').select('id').eq('id', studentId).maybeSingle(),
				db.from('lesson_types').select('id').eq('id', lessonTypeId).maybeSingle()
			]);
			if (student.error) failAccount('setStudentPrice', student.error);
			if (lessonType.error) failAccount('setStudentPrice', lessonType.error);
			if (!student.data || !lessonType.data) throw new AccountStoreError('not_found');

			const { error } =
				priceCents === null
					? await db
							.from('student_prices')
							.delete()
							.eq('student_id', studentId)
							.eq('lesson_type_id', lessonTypeId)
					: await db.from('student_prices').upsert({
							student_id: studentId,
							lesson_type_id: lessonTypeId,
							price_cents: priceCents
						});
			if (error) failAccount('setStudentPrice', error);
		},

		async updateAccountNotes(accountId: string, notes: string): Promise<void> {
			const { data, error } = await db
				.from('accounts')
				.update({ admin_notes: notes })
				.eq('id', accountId)
				.select('id');
			if (error) failAccount('updateAccountNotes', error);
			if ((data as { id: string }[]).length === 0) throw new AccountStoreError('not_found');
		},

		async updateStudentNotes(studentId: string, notes: string): Promise<void> {
			const { data, error } = await db
				.from('students')
				.update({ notes })
				.eq('id', studentId)
				.select('id');
			if (error) failAccount('updateStudentNotes', error);
			if ((data as { id: string }[]).length === 0) throw new AccountStoreError('not_found');
		},

		// ---- SeriesStore ----

		async createSeries(
			input: SeriesInput,
			startsAt: Date[],
			through: string,
			now: Date
		): Promise<{ series: LessonSeries; occurrences: OccurrenceResult[] }> {
			const { data, error } = await db.rpc('create_lesson_series', {
				p_student_id: input.studentId,
				p_lesson_type_id: input.lessonTypeId,
				p_weekday: input.weekday,
				p_start_time: input.startTime,
				p_interval_weeks: input.intervalWeeks,
				p_starts_on: input.startsOn,
				p_ends_on: input.endsOn,
				p_occurrence_count: input.occurrenceCount,
				p_note: input.note,
				p_starts_at: startsAt.map((d) => d.toISOString()),
				p_through: through,
				p_now: now.toISOString()
			});
			if (error) failAccount('createSeries', error);
			const result = data as { series_id: string; occurrences: RpcOccurrenceRow[] };
			const series = await getLessonSeries(result.series_id);
			if (!series) throw new Error('createSeries: series not found after insert');
			return { series, occurrences: mapOccurrences(result.occurrences) };
		},

		async addSeriesOccurrences(
			seriesId: string,
			startsAt: Date[],
			through: string,
			now: Date
		): Promise<OccurrenceResult[]> {
			const { data, error } = await db.rpc('create_series_occurrences', {
				p_series_id: seriesId,
				p_starts_at: startsAt.map((d) => d.toISOString()),
				p_through: through,
				p_now: now.toISOString()
			});
			if (error) failSeries('addSeriesOccurrences', error);
			return mapOccurrences((data as RpcOccurrenceRow[] | null) ?? []);
		},

		async getSeries(id: string): Promise<LessonSeries | null> {
			return getLessonSeries(id);
		},

		async listSeriesForAccount(accountId: string): Promise<LessonSeries[]> {
			const { data, error } = await db
				.from('lesson_series')
				.select(OWNED_SERIES_COLUMNS)
				.eq('students.account_id', accountId)
				.order('created_at', { ascending: false });
			if (error) {
				if (isMalformedId(error)) return [];
				fail('listSeriesForAccount', error);
			}
			return (data as unknown as LessonSeriesRow[]).map(mapLessonSeriesRow);
		},

		async listSeriesBookings(seriesId: string): Promise<AdminBooking[]> {
			const { data, error } = await db
				.from('bookings')
				.select(BOOKING_COLUMNS)
				.eq('series_id', seriesId)
				.order('starts_at');
			if (error) {
				if (isMalformedId(error)) return [];
				fail('listSeriesBookings', error);
			}
			return (data as unknown as AdminBookingRow[]).map(mapAdminBookingRow);
		},

		async listSeriesNeedingTopUp(through: string): Promise<LessonSeries[]> {
			const { data, error } = await db
				.from('lesson_series')
				.select(SERIES_COLUMNS)
				.is('ended_at', null)
				.or(`materialized_through.is.null,materialized_through.lt.${through}`);
			if (error) fail('listSeriesNeedingTopUp', error);
			return (data as unknown as LessonSeriesRow[]).map(mapLessonSeriesRow);
		},

		async endSeries(id: string, from: Date, now: Date): Promise<AdminBooking[]> {
			const { data, error } = await db.rpc('end_series', {
				p_series_id: id,
				p_from: from.toISOString(),
				p_now: now.toISOString()
			});
			if (error) failSeries('endSeries', error);
			const ids = (data as string[] | null) ?? [];
			if (ids.length === 0) return [];
			const rows = await db
				.from('bookings')
				.select(BOOKING_COLUMNS)
				.in('id', ids)
				.order('starts_at');
			if (rows.error) fail('endSeries', rows.error);
			return (rows.data as unknown as AdminBookingRow[]).map(mapAdminBookingRow);
		}
	};
}
