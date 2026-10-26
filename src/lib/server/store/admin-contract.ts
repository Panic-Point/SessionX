import { describe, it, expect, beforeEach } from 'vitest';
import { AdminStoreError, BookingStoreError } from './types';
import type {
	AdminStore,
	AdminStoreErrorCode,
	BookingStore,
	GuestBookingInput,
	LessonTypeInput
} from './types';

const NOW = new Date('2026-11-01T17:00:00Z');
const LESSON_30 = '11111111-0000-0000-0000-000000000030';
const SLOT = new Date('2030-03-04T20:00:00Z');
const NEXT_DAY = new Date('2030-03-05T20:00:00Z');

function input(overrides: Partial<GuestBookingInput> = {}): GuestBookingInput {
	return {
		email: 'ben-parent@example.com',
		accountName: 'Pat Parent',
		studentName: 'Ben',
		lessonTypeId: LESSON_30,
		startsAt: SLOT,
		note: '',
		...overrides
	};
}

function lessonInput(overrides: Partial<LessonTypeInput> = {}): LessonTypeInput {
	return {
		name: 'Masterclass',
		description: 'Deep dive',
		durationMin: 90,
		priceCents: 9000,
		sortOrder: 10,
		active: true,
		...overrides
	};
}

async function adminCode(promise: Promise<unknown>): Promise<AdminStoreErrorCode | null> {
	try {
		await promise;
		return null;
	} catch (e) {
		return e instanceof AdminStoreError ? e.code : null;
	}
}

/** Behaviour every AdminStore implementation must share. Seeded with supabase/seed.sql data. */
export function runAdminStoreContract(
	name: string,
	makeStore: () => Promise<BookingStore & AdminStore>,
	reset?: () => Promise<void>
) {
	describe(`AdminStore contract: ${name}`, () => {
		if (reset) beforeEach(reset);

		it('finds admin account by email case-insensitively', async () => {
			const store = await makeStore();
			const account = await store.findAccountByEmail('  Admin@SessionX.local ');
			expect(account).toMatchObject({ email: 'admin@sessionx.local', role: 'admin' });
			const byId = await store.findAccountById(account!.id);
			expect(byId?.id).toBe(account!.id);
		});

		it('unknown email returns null', async () => {
			const store = await makeStore();
			expect(await store.findAccountByEmail('nobody@example.com')).toBeNull();
		});

		it('consumeLoginToken is single use', async () => {
			const store = await makeStore();
			const admin = (await store.findAccountByEmail('admin@sessionx.local'))!;
			await store.createLoginToken(admin.id, 'hash-single', new Date('2030-01-01T00:00:00Z'));
			expect(await store.consumeLoginToken('hash-single', NOW)).toBe(admin.id);
			expect(await store.consumeLoginToken('hash-single', NOW)).toBeNull();
			expect(await store.consumeLoginToken('hash-unknown', NOW)).toBeNull();
		});

		it('consumeLoginToken rejects expired', async () => {
			const store = await makeStore();
			const admin = (await store.findAccountByEmail('admin@sessionx.local'))!;
			const expiresAt = new Date('2030-01-01T00:00:00Z');
			await store.createLoginToken(admin.id, 'hash-expired', expiresAt);
			expect(await store.consumeLoginToken('hash-expired', expiresAt)).toBeNull();
		});

		it('lists pending bookings ascending with account and student names', async () => {
			const store = await makeStore();
			await store.requestGuestBooking(input({ startsAt: NEXT_DAY }), NOW);
			await store.requestGuestBooking(input({ note: 'Bring scales' }), NOW);
			const list = await store.listBookings({ statuses: ['pending'], order: 'asc' });
			expect(list.map((b) => b.startsAt)).toEqual([SLOT, NEXT_DAY]);
			expect(list[0]).toMatchObject({
				status: 'pending',
				studentName: 'Ben',
				accountName: 'Pat Parent',
				accountEmail: 'ben-parent@example.com',
				lessonTypeName: '30-minute lesson',
				durationMin: 30,
				priceCents: 3500,
				note: 'Bring scales',
				paidAt: null,
				declineReason: null,
				lateCancel: false
			});
			expect(list[0].manageToken.length).toBeGreaterThan(0);
			const desc = await store.listBookings({ statuses: ['pending'], order: 'desc' });
			expect(desc[0].startsAt).toEqual(NEXT_DAY);
			const range = await store.listBookings({
				statuses: ['pending'],
				order: 'asc',
				from: SLOT,
				to: NEXT_DAY
			});
			expect(range).toHaveLength(1);
		});

		it('decideBooking approves pending', async () => {
			const store = await makeStore();
			const created = await store.requestGuestBooking(input(), NOW);
			const decided = await store.decideBooking(created.bookingId, 'approved', null, NOW);
			expect(decided.status).toBe('approved');
			expect((await store.getBooking(created.bookingId))?.status).toBe('approved');
			const live = await store.getLiveBookings(
				new Date('2030-03-04T00:00:00Z'),
				new Date('2030-03-05T00:00:00Z')
			);
			expect(live).toHaveLength(1);
			const summary = await store.getBookingByManageToken(created.manageToken);
			expect(summary?.status).toBe('approved');
		});

		it('decideBooking declines with reason and frees the slot', async () => {
			const store = await makeStore();
			const created = await store.requestGuestBooking(input(), NOW);
			const decided = await store.decideBooking(
				created.bookingId,
				'declined',
				'Away that day',
				NOW
			);
			expect(decided).toMatchObject({ status: 'declined', declineReason: 'Away that day' });
			const again = await store.requestGuestBooking(input({ email: 'other@example.com' }), NOW);
			expect(again.startsAt).toEqual(SLOT);
		});

		it('decideBooking on non-pending throws not_pending', async () => {
			const store = await makeStore();
			const created = await store.requestGuestBooking(input(), NOW);
			await store.decideBooking(created.bookingId, 'approved', null, NOW);
			const code = await adminCode(store.decideBooking(created.bookingId, 'declined', 'x', NOW));
			expect(code).toBe('not_pending');
		});

		it('approving a past booking throws in_past', async () => {
			const store = await makeStore();
			const created = await store.requestGuestBooking(input(), NOW);
			const code = await adminCode(store.decideBooking(created.bookingId, 'approved', null, SLOT));
			expect(code).toBe('in_past');
		});

		it('unknown booking throws not_found', async () => {
			const store = await makeStore();
			const missing = '99999999-0000-0000-0000-000000000000';
			expect(await adminCode(store.decideBooking(missing, 'approved', null, NOW))).toBe(
				'not_found'
			);
			expect(await adminCode(store.setPaid(missing, NOW))).toBe('not_found');
			expect(await store.getBooking(missing)).toBeNull();
		});

		it('setPaid sets and clears paidAt', async () => {
			const store = await makeStore();
			const created = await store.requestGuestBooking(input(), NOW);
			const paidAt = new Date('2030-03-04T21:00:00Z');
			expect((await store.setPaid(created.bookingId, paidAt)).paidAt).toEqual(paidAt);
			expect((await store.getBooking(created.bookingId))?.paidAt).toEqual(paidAt);
			expect((await store.setPaid(created.bookingId, null)).paidAt).toBeNull();
		});

		it('unpaidOnly filter excludes paid', async () => {
			const store = await makeStore();
			const paid = await store.requestGuestBooking(input(), NOW);
			const unpaid = await store.requestGuestBooking(input({ startsAt: NEXT_DAY }), NOW);
			await store.setPaid(paid.bookingId, new Date('2030-03-04T21:00:00Z'));
			const list = await store.listBookings({
				statuses: ['pending'],
				unpaidOnly: true,
				order: 'asc'
			});
			expect(list.map((b) => b.id)).toEqual([unpaid.bookingId]);
		});

		it('updateSettings round-trips', async () => {
			const store = await makeStore();
			const settings = {
				...(await store.getSettings()),
				minNoticeHours: 12,
				bufferMin: 15,
				allowSameDay: true,
				cancellationPolicyText: 'Be kind.'
			};
			await store.updateSettings(settings);
			expect(await store.getSettings()).toEqual(settings);
		});

		it('settings round-trip calendar fields', async () => {
			const store = await makeStore();
			const base = await store.getSettings();
			expect(base.gcalWriteCalendarId).toBeNull();
			expect(base.gcalBusyCalendarIds).toEqual([]);
			const settings = {
				...base,
				gcalWriteCalendarId: 'write@group.calendar.google.com',
				gcalBusyCalendarIds: ['a@example.com', 'b@example.com']
			};
			await store.updateSettings(settings);
			expect(await store.getSettings()).toEqual(settings);
		});

		it('setCalendarEventId sets and clears', async () => {
			const store = await makeStore();
			const created = await store.requestGuestBooking(input(), NOW);
			await store.setCalendarEventId(created.bookingId, 'evt-1');
			expect((await store.getBooking(created.bookingId))?.gcalEventId).toBe('evt-1');
			await store.setCalendarEventId(created.bookingId, null);
			expect((await store.getBooking(created.bookingId))?.gcalEventId).toBeNull();
		});

		it('expires past pending requests and frees the slot', async () => {
			const store = await makeStore();
			const created = await store.requestGuestBooking(input(), NOW);
			const after = new Date(SLOT.getTime() + 60_000);
			expect(await store.expirePendingBookings(after)).toBe(1);
			expect((await store.getBooking(created.bookingId))?.status).toBe('expired');
			const live = await store.getLiveBookings(
				new Date(SLOT.getTime() - 3_600_000),
				new Date(SLOT.getTime() + 3_600_000)
			);
			expect(live).toHaveLength(0);
		});

		it('leaves future pending alone', async () => {
			const store = await makeStore();
			const created = await store.requestGuestBooking(input(), NOW);
			expect(await store.expirePendingBookings(new Date(SLOT.getTime() - 60_000))).toBe(0);
			expect((await store.getBooking(created.bookingId))?.status).toBe('pending');
		});

		it('leaves approved past lessons alone', async () => {
			const store = await makeStore();
			const created = await store.requestGuestBooking(input(), NOW);
			await store.decideBooking(created.bookingId, 'approved', null, NOW);
			expect(await store.expirePendingBookings(new Date(SLOT.getTime() + 60_000))).toBe(0);
			expect((await store.getBooking(created.bookingId))?.status).toBe('approved');
		});

		it('expirePendingBookings is idempotent', async () => {
			const store = await makeStore();
			await store.requestGuestBooking(input(), NOW);
			const after = new Date(SLOT.getTime() + 60_000);
			expect(await store.expirePendingBookings(after)).toBe(1);
			expect(await store.expirePendingBookings(after)).toBe(0);
		});

		it('setCalendarEventId unknown id throws not_found', async () => {
			const store = await makeStore();
			const missing = '99999999-0000-0000-0000-000000000000';
			expect(await adminCode(store.setCalendarEventId(missing, 'evt-1'))).toBe('not_found');
			expect(await adminCode(store.setCalendarEventId('not-a-uuid', 'evt-1'))).toBe('not_found');
		});

		it('admin booking exposes gcalEventId (null by default)', async () => {
			const store = await makeStore();
			const created = await store.requestGuestBooking(input(), NOW);
			expect((await store.getBooking(created.bookingId))?.gcalEventId).toBeNull();
			const list = await store.listBookings({ statuses: ['pending'], order: 'asc' });
			expect(list[0].gcalEventId).toBeNull();
		});

		it('replaceWeeklyHours replaces', async () => {
			const store = await makeStore();
			const hours = [
				{ weekday: 2, start: '10:00', end: '12:00' },
				{ weekday: 4, start: '14:00', end: '18:00' }
			];
			await store.replaceWeeklyHours(hours);
			const stored = await store.getWeeklyHours();
			expect(stored).toHaveLength(2);
			expect(stored).toEqual(expect.arrayContaining(hours));
		});

		it('saveDateOverride then listDateOverrides', async () => {
			const store = await makeStore();
			await store.saveDateOverride({
				date: '2030-05-02',
				isClosed: false,
				ranges: [{ start: '10:00', end: '12:00' }],
				note: 'Short day'
			});
			await store.saveDateOverride({
				date: '2030-05-01',
				isClosed: true,
				ranges: [],
				note: 'Away'
			});
			await store.saveDateOverride({
				date: '2030-05-02',
				isClosed: true,
				ranges: [],
				note: 'Changed'
			});
			const list = await store.listDateOverrides('2030-05-01');
			expect(list.map((o) => [o.date, o.isClosed, o.note])).toEqual([
				['2030-05-01', true, 'Away'],
				['2030-05-02', true, 'Changed']
			]);
			expect(await store.listDateOverrides('2030-05-02')).toHaveLength(1);
		});

		it('deleteDateOverride removes', async () => {
			const store = await makeStore();
			await store.saveDateOverride({ date: '2030-06-01', isClosed: true, ranges: [], note: '' });
			await store.deleteDateOverride('2030-06-01');
			expect(await store.listDateOverrides('2030-06-01')).toEqual([]);
		});

		it('createLessonType then listAllLessonTypes', async () => {
			const store = await makeStore();
			const created = await store.createLessonType(lessonInput());
			expect(created).toMatchObject({ name: 'Masterclass', durationMin: 90, active: true });
			const all = await store.listAllLessonTypes();
			expect(all.map((t) => t.name)).toEqual([
				'30-minute lesson',
				'45-minute lesson',
				'60-minute lesson',
				'Masterclass'
			]);
			expect(all.find((t) => t.id === created.id)?.priceCents).toBe(9000);
		});

		it('inactive lesson type hidden from getActiveLessonTypes', async () => {
			const store = await makeStore();
			const created = await store.createLessonType(lessonInput({ active: false }));
			expect((await store.listAllLessonTypes()).some((t) => t.id === created.id)).toBe(true);
			expect((await store.getActiveLessonTypes()).some((t) => t.id === created.id)).toBe(false);
			let code: string | null = null;
			try {
				await store.requestGuestBooking(input({ lessonTypeId: created.id }), NOW);
			} catch (e) {
				code = e instanceof BookingStoreError ? e.code : null;
			}
			expect(code).toBe('lesson_type_not_found');
		});

		it("bookings keep their booked duration after the lesson type's duration changes", async () => {
			const store = await makeStore();
			const created = await store.requestGuestBooking(input(), NOW);
			const type = (await store.listAllLessonTypes()).find((t) => t.id === LESSON_30)!;
			await store.updateLessonType(LESSON_30, {
				name: type.name,
				description: type.description,
				durationMin: 90,
				priceCents: type.priceCents,
				sortOrder: type.sortOrder,
				active: type.active
			});
			expect((await store.getBooking(created.bookingId))?.durationMin).toBe(30);
			const [listed] = await store.listBookings({ statuses: ['pending'], order: 'asc' });
			expect(listed.durationMin).toBe(30);
			const decided = await store.decideBooking(created.bookingId, 'approved', null, NOW);
			expect(decided.durationMin).toBe(30);
		});

		it('updateLessonType unknown id throws not_found', async () => {
			const store = await makeStore();
			const code = await adminCode(
				store.updateLessonType('99999999-0000-0000-0000-000000000000', lessonInput())
			);
			expect(code).toBe('not_found');
			const target = (await store.listAllLessonTypes())[0];
			const updated = await store.updateLessonType(target.id, lessonInput({ name: 'Renamed' }));
			expect(updated).toMatchObject({ id: target.id, name: 'Renamed' });
		});
	});
}
