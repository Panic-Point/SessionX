import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import {
	LATE_CANCEL_WARNING,
	addMyStudent,
	cancelLesson,
	getAccountHome,
	getCancelView,
	isLateCancel,
	renameMyStudent
} from './account-service';
import type { EmailMessage, Mailer } from './email/mailer';
import { MemoryBookingStore } from './store/memory';

const now = DateTime.fromISO('2026-11-01T12:00', { zone: 'America/New_York' }).toJSDate();
const LESSON_30 = '11111111-0000-0000-0000-000000000030';
const PAT = '22222222-0000-0000-0000-00000000000b';
const AVA = '33333333-0000-0000-0000-0000000000a1';
const BEN = '33333333-0000-0000-0000-0000000000b1';
const hoursFromNow = (h: number) => new Date(now.getTime() + h * 3_600_000);

function setup(fail = false) {
	const store = new MemoryBookingStore();
	const sent: EmailMessage[] = [];
	const mailer: Mailer = {
		async send(msg) {
			if (fail) throw new Error('smtp down');
			sent.push(msg);
		}
	};
	return { store, sent, deps: { store, mailer, appUrl: 'https://example.test' } };
}

async function book(store: MemoryBookingStore, studentId: string, startsAt: Date, approve = false) {
	const c = await store.requestAccountBooking(
		{ accountId: PAT, studentId, lessonTypeId: LESSON_30, startsAt, note: '' },
		now
	);
	if (approve) await store.decideBooking(c.bookingId, 'approved', null, now);
	return { id: c.bookingId, token: c.manageToken };
}

describe('isLateCancel', () => {
	const start = hoursFromNow(24);
	it('exactly at the cutoff is not late', () => {
		expect(isLateCancel('approved', start, now, 24)).toBe(false);
	});
	it('23h59m is late', () => {
		expect(isLateCancel('approved', new Date(start.getTime() - 60_000), now, 24)).toBe(true);
	});
	it('pending inside the cutoff is not late', () => {
		expect(isLateCancel('pending', hoursFromNow(2), now, 24)).toBe(false);
	});
	it('approved outside the cutoff is not late', () => {
		expect(isLateCancel('approved', hoursFromNow(48), now, 24)).toBe(false);
	});
});

describe('account home', () => {
	it('splits upcoming and past', async () => {
		const { store } = setup();
		const later = await book(store, AVA, hoursFromNow(72));
		const soon = await book(store, BEN, hoursFromNow(48), true);
		const gone = await book(store, AVA, hoursFromNow(100));
		await store.cancelBooking({ kind: 'account', bookingId: gone.id, accountId: PAT }, false, now);
		const home = await getAccountHome(store, PAT, now);
		expect(home.students.map((s) => s.name)).toEqual(['Ava', 'Ben']);
		expect(home.upcoming.map((b) => b.id)).toEqual([soon.id, later.id]);
		expect(home.upcoming[0]).toMatchObject({
			statusLabel: 'Confirmed',
			studentName: 'Ben',
			priceLabel: '$30.00',
			canCancel: true,
			lateCancel: false
		});
		expect(home.upcoming[1].statusLabel).toBe('Pending approval');
		expect(home.past.map((b) => b.id)).toEqual([gone.id]);
		expect(home.past[0]).toMatchObject({ statusLabel: 'Cancelled', canCancel: false });
	});

	it('reports lateCancel as what happened, not what would happen', async () => {
		const { store } = setup();
		const upcomingSoon = await book(store, AVA, hoursFromNow(5), true);
		const lateOne = await book(store, BEN, hoursFromNow(6), true);
		await store.cancelBooking(
			{ kind: 'account', bookingId: lateOne.id, accountId: PAT },
			true,
			now
		);
		const pastApproved = await book(store, AVA, hoursFromNow(1), true);
		const home = await getAccountHome(store, PAT, hoursFromNow(3));
		expect(home.upcoming.map((b) => b.id)).toEqual([upcomingSoon.id]);
		expect(home.upcoming[0].lateCancel).toBe(false);
		const past = Object.fromEntries(home.past.map((b) => [b.id, b]));
		expect(past[lateOne.id]).toMatchObject({ status: 'cancelled', lateCancel: true });
		expect(past[pastApproved.id].lateCancel).toBe(false);
	});
});

describe('students', () => {
	it('adds and renames with validation messages', async () => {
		const { store } = setup();
		expect(await addMyStudent(store, PAT, '  ')).toEqual({
			ok: false,
			errors: { name: 'Enter a name.' }
		});
		expect(await addMyStudent(store, PAT, 'x'.repeat(101))).toEqual({
			ok: false,
			errors: { name: 'Keep the name under 100 characters.' }
		});
		expect(await addMyStudent(store, PAT, 'ava')).toEqual({
			ok: false,
			errors: { name: 'You already have a student with that name.' }
		});
		const added = await addMyStudent(store, PAT, '  Cy ');
		expect(added.ok).toBe(true);
		if (added.ok) {
			expect(added.student.name).toBe('Cy');
			expect(added.student.id).toBeTruthy();
			expect((await store.listStudents(PAT)).map((st) => st.id)).toContain(added.student.id);
		}
		expect(await renameMyStudent(store, PAT, AVA, 'Ben')).toEqual({
			ok: false,
			errors: { name: 'You already have a student with that name.' }
		});
		expect(await renameMyStudent(store, PAT, AVA, 'Avery')).toEqual({ ok: true });
		expect(await renameMyStudent(store, 'other', AVA, 'Zed')).toEqual({
			ok: false,
			errors: { name: 'Student not found.' }
		});
		expect(await renameMyStudent(store, PAT, AVA, '')).toEqual({
			ok: false,
			errors: { name: 'Enter a name.' }
		});
	});
});

describe('cancel view', () => {
	it('marks late', async () => {
		const { store } = setup();
		const b = await book(store, AVA, hoursFromNow(5), true);
		const v = await getCancelView(store, { kind: 'token', manageToken: b.token }, now);
		expect(v!.late).toBe(true);
		expect(v!.cutoffHours).toBe(24);
		expect(v!.booking.durationMin).toBe(30);
		expect(v!.policyText).toContain('cancel at least 24 hours');
		expect(LATE_CANCEL_WARNING(24)).toBe(
			'This is less than 24 hours before your lesson, so it falls outside our cancellation policy and you may still be charged.'
		);
	});

	it('hides account name and email', async () => {
		const { store } = setup();
		const b = await book(store, AVA, hoursFromNow(72));
		const v = await getCancelView(store, { kind: 'token', manageToken: b.token }, now);
		const json = JSON.stringify(v);
		expect(json).not.toContain('Pat Parent');
		expect(json).not.toContain('parent@example.com');
	});

	it('is null for unknown or another account', async () => {
		const { store } = setup();
		const b = await book(store, AVA, hoursFromNow(72));
		expect(await getCancelView(store, { kind: 'token', manageToken: 'nope' }, now)).toBeNull();
		expect(
			await getCancelView(store, { kind: 'account', bookingId: b.id, accountId: 'other' }, now)
		).toBeNull();
	});
});

describe('cancelLesson', () => {
	it('sends confirmation and late notice', async () => {
		const { deps, store, sent } = setup();
		const b = await book(store, AVA, hoursFromNow(5), true);
		const r = await cancelLesson(deps, { kind: 'account', bookingId: b.id, accountId: PAT }, now);
		expect(r).toEqual({ ok: true, late: true });
		expect(sent.map((m) => m.to)).toEqual(['parent@example.com', 'admin@sessionx.local']);
		expect(sent[0].subject).toContain('Lesson cancelled');
		expect(sent[1].subject).toContain('Late cancellation: Ava');
		expect(sent[1].text).toContain('https://example.test/admin/lessons');
	});

	it('token cancel emails the booker from the booking', async () => {
		const { deps, store, sent } = setup();
		const b = await book(store, AVA, hoursFromNow(72));
		const r = await cancelLesson(deps, { kind: 'token', manageToken: b.token }, now);
		expect(r).toEqual({ ok: true, late: false });
		expect(sent[0].to).toBe('parent@example.com');
		expect(sent[1].subject).toContain('Lesson cancelled: Ava');
	});

	it('cancel on handled booking sends nothing', async () => {
		const { deps, store, sent } = setup();
		const b = await book(store, AVA, hoursFromNow(72));
		await store.cancelBooking({ kind: 'token', manageToken: b.token }, false, now);
		const r = await cancelLesson(deps, { kind: 'token', manageToken: b.token }, now);
		expect(r).toEqual({ ok: false, message: 'This lesson can no longer be cancelled online.' });
		expect(sent).toEqual([]);
	});

	it("cannot cancel another account's booking", async () => {
		const { deps, store, sent } = setup();
		const b = await book(store, AVA, hoursFromNow(72));
		const r = await cancelLesson(
			deps,
			{ kind: 'account', bookingId: b.id, accountId: 'other' },
			now
		);
		expect(r).toEqual({ ok: false, message: 'Booking not found.' });
		expect(sent).toEqual([]);
	});

	it('email failure does not fail cancellation', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { deps, store } = setup(true);
		const b = await book(store, AVA, hoursFromNow(72));
		const r = await cancelLesson(deps, { kind: 'token', manageToken: b.token }, now);
		expect(r.ok).toBe(true);
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});
});
