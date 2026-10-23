import { createClient } from '@supabase/supabase-js';
import type { DateOverride, WeeklyHours } from '../availability';
import {
	mapLessonTypeRow,
	mapLiveBookingRow,
	mapOverrides,
	mapRpcError,
	mapSettingsRow,
	mapWeeklyHoursRow,
	type DateOverrideRangeRow,
	type DateOverrideRow,
	type LessonTypeRow,
	type LiveBookingRow,
	type SettingsRow,
	type WeeklyHoursRow
} from './supabase-mappers';
import type {
	BookingStatus,
	BookingStore,
	BookingSummary,
	CreatedBooking,
	GuestBookingInput,
	LessonType,
	LiveBooking,
	StudioSettings
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

/** BookingStore backed by Supabase. Uses the service-role key, so server-side only. */
export function createSupabaseBookingStore(url: string, serviceRoleKey: string): BookingStore {
	const db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

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
		}
	};
}
