import { describe, it, expect } from 'vitest';
import { BookingStoreError } from './types';
import type { BookingStore, BookingStoreErrorCode, GuestBookingInput } from './types';

const NOW = new Date('2026-11-01T17:00:00Z');
const LESSON_30 = '11111111-0000-0000-0000-000000000030';
const LESSON_60 = '11111111-0000-0000-0000-000000000060';

function input(overrides: Partial<GuestBookingInput> = {}): GuestBookingInput {
	return {
		email: 'ben-parent@example.com',
		accountName: 'Pat Parent',
		studentName: 'Ben',
		lessonTypeId: LESSON_30,
		startsAt: new Date('2030-03-04T20:00:00Z'),
		note: '',
		...overrides
	};
}

async function errorCode(promise: Promise<unknown>): Promise<BookingStoreErrorCode | null> {
	try {
		await promise;
		return null;
	} catch (e) {
		return e instanceof BookingStoreError ? e.code : null;
	}
}

/** Behaviour every BookingStore implementation must share. Seeded with supabase/seed.sql data. */
export function runBookingStoreContract(name: string, makeStore: () => Promise<BookingStore>) {
	describe(`BookingStore contract: ${name}`, () => {
		it('returns seeded settings', async () => {
			const settings = await (await makeStore()).getSettings();
			expect(settings).toMatchObject({
				timezone: 'America/New_York',
				minNoticeHours: 24,
				maxAdvanceDays: 60,
				cancelCutoffHours: 24,
				allowSameDay: false,
				adminEmail: 'admin@sessionx.local'
			});
		});

		it('returns active lesson types in order', async () => {
			const types = await (await makeStore()).getActiveLessonTypes();
			expect(types.map((t) => [t.durationMin, t.priceCents])).toEqual([
				[30, 3500],
				[45, 5000],
				[60, 6500]
			]);
		});

		it('creates a pending booking at list price', async () => {
			const store = await makeStore();
			const created = await store.requestGuestBooking(input(), NOW);
			expect(created.priceCents).toBe(3500);
			expect(created.startsAt).toEqual(new Date('2030-03-04T20:00:00Z'));
			expect(created.endsAt).toEqual(new Date('2030-03-04T20:30:00Z'));
			expect(created.manageToken.length).toBeGreaterThan(0);
		});

		it('reuses account by email case-insensitively', async () => {
			const store = await makeStore();
			const first = await store.requestGuestBooking(input(), NOW);
			const second = await store.requestGuestBooking(
				input({
					email: '  BEN-Parent@Example.com ',
					accountName: 'Someone Else',
					startsAt: new Date('2030-03-05T20:00:00Z')
				}),
				NOW
			);
			const summary = await store.getBookingByManageToken(second.manageToken);
			expect(summary?.accountName).toBe('Pat Parent');
			expect(second.bookingId).not.toBe(first.bookingId);
		});

		it('rejects overlapping request', async () => {
			const store = await makeStore();
			await store.requestGuestBooking(input(), NOW);
			const code = await errorCode(
				store.requestGuestBooking(
					input({ email: 'other@example.com', startsAt: new Date('2030-03-04T20:15:00Z') }),
					NOW
				)
			);
			expect(code).toBe('slot_taken');
		});

		it('allows back-to-back request', async () => {
			const store = await makeStore();
			await store.requestGuestBooking(input(), NOW);
			const second = await store.requestGuestBooking(
				input({ email: 'other@example.com', startsAt: new Date('2030-03-04T20:30:00Z') }),
				NOW
			);
			expect(second.startsAt).toEqual(new Date('2030-03-04T20:30:00Z'));
		});

		it('third pending request is rejected', async () => {
			const store = await makeStore();
			await store.requestGuestBooking(input({ startsAt: new Date('2030-03-04T20:00:00Z') }), NOW);
			await store.requestGuestBooking(input({ startsAt: new Date('2030-03-05T20:00:00Z') }), NOW);
			const code = await errorCode(
				store.requestGuestBooking(input({ startsAt: new Date('2030-03-06T20:00:00Z') }), NOW)
			);
			expect(code).toBe('too_many_pending');
		});

		it('unknown lesson type is rejected', async () => {
			const store = await makeStore();
			const code = await errorCode(
				store.requestGuestBooking(
					input({ lessonTypeId: '99999999-0000-0000-0000-000000000000' }),
					NOW
				)
			);
			expect(code).toBe('lesson_type_not_found');
		});

		it('live bookings include the new pending booking', async () => {
			const store = await makeStore();
			const created = await store.requestGuestBooking(
				input({ lessonTypeId: LESSON_60, startsAt: new Date('2030-03-04T20:00:00Z') }),
				NOW
			);
			const live = await store.getLiveBookings(
				new Date('2030-03-04T00:00:00Z'),
				new Date('2030-03-05T00:00:00Z')
			);
			expect(live).toHaveLength(1);
			expect(live[0].startsAt).toEqual(created.startsAt);
			expect(live[0].endsAt).toEqual(new Date('2030-03-04T21:00:00Z'));
			expect(live[0].blockedUntil.getTime()).toBeGreaterThanOrEqual(live[0].endsAt.getTime());
			const none = await store.getLiveBookings(
				new Date('2030-03-05T00:00:00Z'),
				new Date('2030-03-06T00:00:00Z')
			);
			expect(none).toEqual([]);
		});

		it('finds booking by manage token', async () => {
			const store = await makeStore();
			const created = await store.requestGuestBooking(input({ note: 'Bring scales' }), NOW);
			const summary = await store.getBookingByManageToken(created.manageToken);
			expect(summary).toMatchObject({
				status: 'pending',
				lessonTypeName: '30-minute lesson',
				studentName: 'Ben',
				accountName: 'Pat Parent',
				priceCents: 3500,
				note: 'Bring scales'
			});
		});

		it('unknown manage token returns null', async () => {
			const store = await makeStore();
			expect(await store.getBookingByManageToken('no-such-token')).toBeNull();
		});

		it('date overrides filtered to range', async () => {
			const store = await makeStore();
			// The seed has no overrides, so any range is empty. Implementations that can be
			// seeded with overrides cover filtering in their own tests.
			expect(await store.getDateOverrides('2030-01-01', '2030-12-31')).toEqual([]);
		});
	});
}
