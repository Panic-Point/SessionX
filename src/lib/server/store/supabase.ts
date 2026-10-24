import { createClient } from '@supabase/supabase-js';
import type { DateOverride, WeeklyHours } from '../availability';
import {
	mapAccountRow,
	mapAdminBookingRow,
	mapAdminLessonTypeRow,
	mapLessonTypeRow,
	mapLiveBookingRow,
	mapOverrides,
	mapOverridesWithNotes,
	mapRpcError,
	mapSettingsRow,
	mapWeeklyHoursRow,
	type AccountRow,
	type AdminBookingRow,
	type AdminLessonTypeRow,
	type DateOverrideRangeRow,
	type DateOverrideRow,
	type LessonTypeRow,
	type LiveBookingRow,
	type SettingsRow,
	type WeeklyHoursRow
} from './supabase-mappers';
import {
	AdminStoreError,
	type Account,
	type AdminBooking,
	type AdminLessonType,
	type AdminStore,
	type BookingFilter,
	type BookingStatus,
	type BookingStore,
	type BookingSummary,
	type CreatedBooking,
	type DateOverrideWithNote,
	type GuestBookingInput,
	type LessonType,
	type LessonTypeInput,
	type LiveBooking,
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
	'id, status, starts_at, ends_at, price_cents, paid_at, note, decline_reason, late_cancel, manage_token, lesson_types(name, duration_min), students(name, accounts(name, email))';

const lessonTypeColumns = (input: LessonTypeInput) => ({
	name: input.name,
	description: input.description,
	duration_min: input.durationMin,
	price_cents: input.priceCents,
	sort_order: input.sortOrder,
	active: input.active
});

/** BookingStore and AdminStore backed by Supabase. Uses the service-role key, so server-side only. */
export function createSupabaseBookingStore(
	url: string,
	serviceRoleKey: string
): BookingStore & AdminStore {
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

	return {
		async getSettings(): Promise<StudioSettings> {
			const { data, error } = await db
				.from('settings')
				.select(
					'timezone, min_notice_hours, max_advance_days, slot_increment_min, buffer_min, allow_same_day, cancel_cutoff_hours, cancellation_policy_text, admin_email'
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

		async listBookings(filter: BookingFilter): Promise<AdminBooking[]> {
			let query = db
				.from('bookings')
				.select(BOOKING_COLUMNS)
				.in('status', filter.statuses)
				.order('starts_at', { ascending: filter.order === 'asc' });
			if (filter.from) query = query.gte('starts_at', filter.from.toISOString());
			if (filter.to) query = query.lt('starts_at', filter.to.toISOString());
			if (filter.unpaidOnly) query = query.is('paid_at', null);
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
					updated_at: new Date().toISOString()
				})
				.eq('id', true);
			if (error) fail('updateSettings', error);
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
		}
	};
}
