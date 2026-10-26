import { describe, it, expect, beforeEach } from 'vitest';
import { AccountStoreError, BookingStoreError } from './types';
import type {
	AccountBookingInput,
	AccountStoreErrorCode,
	AppStore,
	BookingStoreErrorCode
} from './types';

const NOW = new Date('2026-11-01T17:00:00Z');
const PAT = '22222222-0000-0000-0000-00000000000b';
const AVA = '33333333-0000-0000-0000-0000000000a1';
const BEN = '33333333-0000-0000-0000-0000000000b1';
const LESSON_30 = '11111111-0000-0000-0000-000000000030';
const LESSON_45 = '11111111-0000-0000-0000-000000000045';
const NO_SUCH_LESSON = '11111111-0000-0000-0000-0000000000ff';
const NO_SUCH_ACCOUNT = '22222222-0000-0000-0000-0000000000ff';
const NO_SUCH_STUDENT = '33333333-0000-0000-0000-0000000000ff';
const DAY_1 = new Date('2030-03-04T20:00:00Z');
const DAY_2 = new Date('2030-03-05T20:00:00Z');
const DAY_3 = new Date('2030-03-06T20:00:00Z');

function booking(overrides: Partial<AccountBookingInput> = {}): AccountBookingInput {
	return {
		accountId: PAT,
		studentId: AVA,
		lessonTypeId: LESSON_30,
		startsAt: DAY_1,
		note: '',
		...overrides
	};
}

async function accountCode(promise: Promise<unknown>): Promise<AccountStoreErrorCode | null> {
	try {
		await promise;
		return null;
	} catch (e) {
		return e instanceof AccountStoreError ? e.code : null;
	}
}

async function bookingCode(promise: Promise<unknown>): Promise<BookingStoreErrorCode | null> {
	try {
		await promise;
		return null;
	} catch (e) {
		return e instanceof BookingStoreError ? e.code : null;
	}
}

/** Creates a second account (with one student, "Zed") through the guest flow. */
async function otherAccount(store: AppStore) {
	await store.requestGuestBooking(
		{
			email: 'other-family@example.com',
			accountName: 'Other Family',
			studentName: 'Zed',
			lessonTypeId: LESSON_30,
			startsAt: new Date('2030-04-01T20:00:00Z'),
			note: ''
		},
		NOW
	);
	const account = (await store.findAccountByEmail('other-family@example.com'))!;
	const [student] = await store.listStudents(account.id);
	return { account, student };
}

/** Behaviour every AccountStore implementation must share. Seeded with supabase/seed.sql data. */
export function runAccountStoreContract(
	name: string,
	makeStore: () => Promise<AppStore>,
	reset?: () => Promise<void>
) {
	describe(`AccountStore contract: ${name}`, () => {
		if (reset) beforeEach(reset);

		it('lists students by name', async () => {
			const store = await makeStore();
			const students = await store.listStudents(PAT);
			expect(students.map((s) => s.name)).toEqual(['Ava', 'Ben']);
			expect(students[0]).toMatchObject({ id: AVA, accountId: PAT, notes: '' });
		});

		it('adds a student', async () => {
			const store = await makeStore();
			const added = await store.addStudent(PAT, '  Cleo ');
			expect(added).toMatchObject({ accountId: PAT, name: 'Cleo', notes: '' });
			expect((await store.listStudents(PAT)).map((s) => s.name)).toEqual(['Ava', 'Ben', 'Cleo']);
		});

		it('rejects duplicate student name case-insensitively', async () => {
			const store = await makeStore();
			expect(await accountCode(store.addStudent(PAT, '  aVa '))).toBe('duplicate_student');
			expect(await store.listStudents(PAT)).toHaveLength(2);
			// Same name under a different account is fine.
			const { account } = await otherAccount(store);
			expect((await store.addStudent(account.id, 'Ava')).name).toBe('Ava');
		});

		it('renames own student', async () => {
			const store = await makeStore();
			const renamed = await store.renameStudent(PAT, AVA, ' Avery ');
			expect(renamed).toMatchObject({ id: AVA, name: 'Avery' });
			expect((await store.listStudents(PAT)).map((s) => s.name)).toEqual(['Avery', 'Ben']);
			// Changing only the case of its own name is the same row, so allowed.
			expect((await store.renameStudent(PAT, AVA, 'AVERY')).name).toBe('AVERY');
			expect(await accountCode(store.renameStudent(PAT, AVA, 'ben'))).toBe('duplicate_student');
		});

		it("cannot rename another account's student", async () => {
			const store = await makeStore();
			const { account } = await otherAccount(store);
			expect(await accountCode(store.renameStudent(account.id, AVA, 'Hacked'))).toBe('not_found');
			expect((await store.listStudents(PAT))[0].name).toBe('Ava');
		});

		it('account booking uses custom price', async () => {
			const store = await makeStore();
			const created = await store.requestAccountBooking(booking({ studentId: BEN }), NOW);
			expect(created.priceCents).toBe(3000);
			expect(created.endsAt.getTime() - created.startsAt.getTime()).toBe(30 * 60_000);
			const stored = await store.getBooking(created.bookingId);
			expect(stored).toMatchObject({ status: 'pending', studentName: 'Ben', priceCents: 3000 });
		});

		it('account booking uses list price without custom', async () => {
			const store = await makeStore();
			const forAva = await store.requestAccountBooking(booking(), NOW);
			expect(forAva.priceCents).toBe(3500);
			// Ben's custom price is only for the 30-minute type.
			const forBen = await store.requestAccountBooking(
				booking({ studentId: BEN, lessonTypeId: LESSON_45, startsAt: DAY_2, note: 'hi' }),
				NOW
			);
			expect(forBen.priceCents).toBe(5000);
			expect((await store.getBooking(forBen.bookingId))?.note).toBe('hi');
		});

		it('rejects student from another account', async () => {
			const store = await makeStore();
			const { account, student } = await otherAccount(store);
			const notMine = store.requestAccountBooking(booking({ studentId: student.id }), NOW);
			expect(await accountCode(notMine)).toBe('not_found');
			const notTheirs = store.requestAccountBooking(
				booking({ accountId: account.id, studentId: AVA }),
				NOW
			);
			expect(await accountCode(notTheirs)).toBe('not_found');
			expect(await store.listAccountBookings(PAT)).toHaveLength(0);
		});

		it('rejects unknown lesson type and slot clash without creating anything', async () => {
			const store = await makeStore();
			const unknownType = store.requestAccountBooking(
				booking({ lessonTypeId: NO_SUCH_LESSON }),
				NOW
			);
			expect(await bookingCode(unknownType)).toBe('lesson_type_not_found');
			await store.requestAccountBooking(booking(), NOW);
			const clash = store.requestAccountBooking(booking({ studentId: BEN }), NOW);
			expect(await bookingCode(clash)).toBe('slot_taken');
			expect(await store.listAccountBookings(PAT)).toHaveLength(1);
		});

		it('account booking pending limit', async () => {
			const store = await makeStore();
			await store.requestAccountBooking(booking({ startsAt: DAY_1 }), NOW);
			await store.requestAccountBooking(booking({ studentId: BEN, startsAt: DAY_2 }), NOW);
			const third = store.requestAccountBooking(booking({ startsAt: DAY_3 }), NOW);
			expect(await bookingCode(third)).toBe('too_many_pending');
			expect(await store.listAccountBookings(PAT)).toHaveLength(2);
		});

		it('lists account bookings across students newest first', async () => {
			const store = await makeStore();
			const { account } = await otherAccount(store);
			const first = await store.requestAccountBooking(booking({ startsAt: DAY_1 }), NOW);
			const second = await store.requestAccountBooking(
				booking({ studentId: BEN, startsAt: DAY_2 }),
				NOW
			);
			const list = await store.listAccountBookings(PAT);
			expect(list.map((b) => b.id)).toEqual([second.bookingId, first.bookingId]);
			expect(list.map((b) => b.studentName)).toEqual(['Ben', 'Ava']);
			expect(await store.listAccountBookings(account.id)).toHaveLength(1);
		});

		it('cancels own booking and frees the slot', async () => {
			const store = await makeStore();
			const created = await store.requestAccountBooking(booking(), NOW);
			const target = { kind: 'account', bookingId: created.bookingId, accountId: PAT } as const;
			const cancelled = await store.cancelBooking(target, false, NOW);
			expect(cancelled).toMatchObject({
				id: created.bookingId,
				status: 'cancelled',
				lateCancel: false
			});
			expect((await store.getBookingByTarget(target))?.status).toBe('cancelled');
			const again = await store.requestAccountBooking(booking({ studentId: BEN }), NOW);
			expect(again.startsAt).toEqual(DAY_1);
		});

		it('cancel records late flag', async () => {
			const store = await makeStore();
			const created = await store.requestAccountBooking(booking(), NOW);
			const cancelled = await store.cancelBooking(
				{ kind: 'account', bookingId: created.bookingId, accountId: PAT },
				true,
				NOW
			);
			expect(cancelled.lateCancel).toBe(true);
			expect((await store.getBooking(created.bookingId))?.lateCancel).toBe(true);
		});

		it("cannot cancel another account's booking", async () => {
			const store = await makeStore();
			const { account } = await otherAccount(store);
			const created = await store.requestAccountBooking(booking(), NOW);
			const target = {
				kind: 'account',
				bookingId: created.bookingId,
				accountId: account.id
			} as const;
			expect(await store.getBookingByTarget(target)).toBeNull();
			expect(await accountCode(store.cancelBooking(target, false, NOW))).toBe('not_found');
			expect((await store.getBooking(created.bookingId))?.status).toBe('pending');
		});

		it('cancel by manage token', async () => {
			const store = await makeStore();
			const created = await store.requestAccountBooking(booking(), NOW);
			const target = { kind: 'token', manageToken: created.manageToken } as const;
			expect((await store.getBookingByTarget(target))?.id).toBe(created.bookingId);
			const cancelled = await store.cancelBooking(target, true, NOW);
			expect(cancelled).toMatchObject({ status: 'cancelled', lateCancel: true });
			const unknown = { kind: 'token', manageToken: 'nope' } as const;
			expect(await store.getBookingByTarget(unknown)).toBeNull();
			expect(await accountCode(store.cancelBooking(unknown, false, NOW))).toBe('not_found');
		});

		it('cancelling a cancelled booking is not_cancellable', async () => {
			const store = await makeStore();
			const created = await store.requestAccountBooking(booking(), NOW);
			const target = { kind: 'account', bookingId: created.bookingId, accountId: PAT } as const;
			await store.cancelBooking(target, false, NOW);
			expect(await accountCode(store.cancelBooking(target, true, NOW))).toBe('not_cancellable');
			expect((await store.getBooking(created.bookingId))?.lateCancel).toBe(false);
		});

		it('cancelling a past booking is not_cancellable', async () => {
			const store = await makeStore();
			const created = await store.requestAccountBooking(booking(), NOW);
			const target = { kind: 'account', bookingId: created.bookingId, accountId: PAT } as const;
			// startsAt <= now is not cancellable.
			expect(await accountCode(store.cancelBooking(target, false, DAY_1))).toBe('not_cancellable');
			expect((await store.getBooking(created.bookingId))?.status).toBe('pending');
		});

		it('lists accounts with students and prices', async () => {
			const store = await makeStore();
			const accounts = await store.listAccounts();
			expect(accounts.map((a) => a.name)).toEqual(['Pat Parent', 'Studio Admin']);
			const pat = accounts.find((a) => a.id === PAT)!;
			expect(pat).toMatchObject({ email: 'parent@example.com', role: 'client', adminNotes: '' });
			expect(pat.students.map((s) => s.name)).toEqual(['Ava', 'Ben']);
			expect(pat.students[0].prices).toEqual([]);
			expect(pat.students[1].prices).toEqual([
				{ studentId: BEN, lessonTypeId: LESSON_30, priceCents: 3000 }
			]);
			expect((await store.getAccount(PAT))?.students).toHaveLength(2);
			expect(await store.getAccount(NO_SUCH_ACCOUNT)).toBeNull();
			expect(await store.listStudentPrices([AVA, BEN])).toEqual([
				{ studentId: BEN, lessonTypeId: LESSON_30, priceCents: 3000 }
			]);
			expect(await store.listStudentPrices([])).toEqual([]);
		});

		it('setStudentPrice sets and clears', async () => {
			const store = await makeStore();
			await store.setStudentPrice(AVA, LESSON_45, 4000);
			await store.setStudentPrice(BEN, LESSON_30, 2500);
			const prices = await store.listStudentPrices([AVA, BEN]);
			expect(prices).toHaveLength(2);
			expect(prices).toContainEqual({ studentId: AVA, lessonTypeId: LESSON_45, priceCents: 4000 });
			expect(prices).toContainEqual({ studentId: BEN, lessonTypeId: LESSON_30, priceCents: 2500 });
			const created = await store.requestAccountBooking(booking({ lessonTypeId: LESSON_45 }), NOW);
			expect(created.priceCents).toBe(4000);
			await store.setStudentPrice(AVA, LESSON_45, null);
			await store.setStudentPrice(BEN, LESSON_30, null);
			expect(await store.listStudentPrices([AVA, BEN])).toEqual([]);
			expect(await accountCode(store.setStudentPrice(NO_SUCH_STUDENT, LESSON_45, 100))).toBe(
				'not_found'
			);
		});

		it('updates account and student notes', async () => {
			const store = await makeStore();
			await store.updateAccountNotes(PAT, 'Pays by cheque');
			await store.updateStudentNotes(AVA, 'Left-handed');
			const pat = (await store.getAccount(PAT))!;
			expect(pat.adminNotes).toBe('Pays by cheque');
			expect(pat.students.find((s) => s.id === AVA)?.notes).toBe('Left-handed');
			expect((await store.listStudents(PAT)).find((s) => s.id === AVA)?.notes).toBe('Left-handed');
			expect(await accountCode(store.updateAccountNotes(NO_SUCH_ACCOUNT, 'x'))).toBe('not_found');
			expect(await accountCode(store.updateStudentNotes(NO_SUCH_STUDENT, 'x'))).toBe('not_found');
		});

		it('lateCancelOnly filter', async () => {
			const store = await makeStore();
			const late = await store.requestAccountBooking(booking({ startsAt: DAY_1 }), NOW);
			const early = await store.requestAccountBooking(booking({ startsAt: DAY_2 }), NOW);
			await store.cancelBooking(
				{ kind: 'account', bookingId: late.bookingId, accountId: PAT },
				true,
				NOW
			);
			await store.cancelBooking(
				{ kind: 'account', bookingId: early.bookingId, accountId: PAT },
				false,
				NOW
			);
			const all = await store.listBookings({ statuses: ['cancelled'], order: 'asc' });
			expect(all).toHaveLength(2);
			const lateOnly = await store.listBookings({
				statuses: ['cancelled'],
				lateCancelOnly: true,
				order: 'asc'
			});
			expect(lateOnly.map((b) => b.id)).toEqual([late.bookingId]);
		});
	});
}
