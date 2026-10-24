import { describe, it, expect } from 'vitest';
import {
	mapSettingsRow,
	mapWeeklyHoursRow,
	mapOverrides,
	mapLessonTypeRow,
	mapLiveBookingRow,
	mapRpcError,
	mapAccountRow,
	mapAdminBookingRow,
	mapAdminLessonTypeRow,
	mapOverridesWithNotes
} from './supabase-mappers';

describe('supabase mappers', () => {
	it('maps a settings row', () => {
		const s = mapSettingsRow({
			timezone: 'America/New_York',
			min_notice_hours: 24,
			max_advance_days: 60,
			slot_increment_min: 30,
			buffer_min: 10,
			allow_same_day: false,
			cancel_cutoff_hours: 12,
			cancellation_policy_text: 'Policy',
			admin_email: null
		});
		expect(s).toEqual({
			timezone: 'America/New_York',
			minNoticeHours: 24,
			maxAdvanceDays: 60,
			slotIncrementMin: 30,
			bufferMin: 10,
			allowSameDay: false,
			cancelCutoffHours: 12,
			cancellationPolicyText: 'Policy',
			adminEmail: null
		});
	});

	it('trims seconds from weekly hours times', () => {
		expect(mapWeeklyHoursRow({ weekday: 2, start_time: '15:00:00', end_time: '18:30:00' })).toEqual(
			{
				weekday: 2,
				start: '15:00',
				end: '18:30'
			}
		);
	});

	it('groups override ranges by date and keeps closed days with no ranges', () => {
		const result = mapOverrides(
			[
				{ date: '2030-01-02', is_closed: false, note: null },
				{ date: '2030-01-01', is_closed: true, note: 'Holiday' }
			],
			[
				{ date: '2030-01-02', start_time: '09:00:00', end_time: '11:00:00' },
				{ date: '2030-01-02', start_time: '13:00:00', end_time: '15:00:00' }
			]
		);
		expect(result).toEqual([
			{ date: '2030-01-01', isClosed: true, ranges: [] },
			{
				date: '2030-01-02',
				isClosed: false,
				ranges: [
					{ start: '09:00', end: '11:00' },
					{ start: '13:00', end: '15:00' }
				]
			}
		]);
	});

	it('maps a lesson type row', () => {
		expect(
			mapLessonTypeRow({
				id: 'abc',
				name: '30-minute lesson',
				description: 'd',
				duration_min: 30,
				price_cents: 3500,
				sort_order: 1
			})
		).toEqual({
			id: 'abc',
			name: '30-minute lesson',
			description: 'd',
			durationMin: 30,
			priceCents: 3500,
			sortOrder: 1
		});
	});

	it('maps a live booking row to Dates', () => {
		const b = mapLiveBookingRow({
			starts_at: '2030-03-04T20:00:00+00:00',
			ends_at: '2030-03-04T20:30:00+00:00',
			blocked_until: '2030-03-04T20:40:00+00:00'
		});
		expect(b.startsAt).toEqual(new Date('2030-03-04T20:00:00Z'));
		expect(b.endsAt).toEqual(new Date('2030-03-04T20:30:00Z'));
		expect(b.blockedUntil).toEqual(new Date('2030-03-04T20:40:00Z'));
	});

	it.each([
		['23P01', 'slot_taken'],
		['P0001', 'too_many_pending'],
		['P0002', 'lesson_type_not_found']
	])('maps RPC error %s to %s', (code, expected) => {
		const err = mapRpcError({ code, message: 'x' });
		expect(err?.code).toBe(expected);
	});

	it('returns null for unknown or missing codes', () => {
		expect(mapRpcError({ code: '42P01', message: 'boom' })).toBeNull();
		expect(mapRpcError({ message: 'boom' })).toBeNull();
	});

	it('maps an account row', () => {
		expect(mapAccountRow({ id: 'a', name: 'Pat', email: 'p@x.com', role: 'admin' })).toEqual({
			id: 'a',
			name: 'Pat',
			email: 'p@x.com',
			role: 'admin'
		});
	});

	it('maps an admin lesson type row including active', () => {
		expect(
			mapAdminLessonTypeRow({
				id: 'abc',
				name: 'n',
				description: 'd',
				duration_min: 45,
				price_cents: 5000,
				sort_order: 2,
				active: false
			})
		).toEqual({
			id: 'abc',
			name: 'n',
			description: 'd',
			durationMin: 45,
			priceCents: 5000,
			sortOrder: 2,
			active: false
		});
	});

	const adminRow = {
		id: 'b1',
		status: 'approved' as const,
		starts_at: '2030-03-04T20:00:00+00:00',
		ends_at: '2030-03-04T20:30:00+00:00',
		price_cents: 3500,
		paid_at: '2030-03-05T10:00:00+00:00',
		note: 'hi',
		decline_reason: 'busy',
		late_cancel: true,
		manage_token: 'tok',
		lesson_types: { name: '30-minute lesson', duration_min: 30 },
		students: { name: 'Ava', accounts: { name: 'Pat', email: 'pat@example.com' } }
	};

	it('maps an admin booking row with embeds', () => {
		expect(mapAdminBookingRow(adminRow)).toEqual({
			id: 'b1',
			status: 'approved',
			startsAt: new Date('2030-03-04T20:00:00Z'),
			endsAt: new Date('2030-03-04T20:30:00Z'),
			lessonTypeName: '30-minute lesson',
			durationMin: 30,
			studentName: 'Ava',
			accountName: 'Pat',
			accountEmail: 'pat@example.com',
			priceCents: 3500,
			paidAt: new Date('2030-03-05T10:00:00Z'),
			note: 'hi',
			declineReason: 'busy',
			lateCancel: true,
			manageToken: 'tok'
		});
	});

	it("derives durationMin from the booking's own times, not the lesson type's current length", () => {
		const b = mapAdminBookingRow({
			...adminRow,
			lesson_types: { name: '30-minute lesson', duration_min: 90 }
		});
		expect(b.durationMin).toBe(30);
	});

	it('maps null paid_at and decline_reason to null', () => {
		const b = mapAdminBookingRow({ ...adminRow, paid_at: null, decline_reason: null });
		expect(b.paidAt).toBeNull();
		expect(b.declineReason).toBeNull();
	});

	it('falls back to empty strings for missing embeds', () => {
		const b = mapAdminBookingRow({ ...adminRow, lesson_types: null, students: null });
		expect(b.lessonTypeName).toBe('');
		expect(b.durationMin).toBe(30);
		expect(b.studentName).toBe('');
		expect(b.accountName).toBe('');
		expect(b.accountEmail).toBe('');
	});

	it('groups override ranges with notes, null note becomes empty', () => {
		expect(
			mapOverridesWithNotes(
				[
					{ date: '2030-01-02', is_closed: false, note: null },
					{ date: '2030-01-01', is_closed: true, note: 'Holiday' }
				],
				[{ date: '2030-01-02', start_time: '09:00:00', end_time: '11:00:00' }]
			)
		).toEqual([
			{ date: '2030-01-01', isClosed: true, ranges: [], note: 'Holiday' },
			{
				date: '2030-01-02',
				isClosed: false,
				ranges: [{ start: '09:00', end: '11:00' }],
				note: ''
			}
		]);
	});
});
