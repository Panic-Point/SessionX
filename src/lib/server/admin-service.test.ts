import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import {
	decideRequest,
	listLessons,
	listPendingRequests,
	setLessonPaid,
	type AdminDeps
} from './admin-service';
import type { EmailMessage, Mailer } from './email/mailer';
import { demoData } from './store/demo-data';
import { MemoryBookingStore } from './store/memory';

const now = DateTime.fromISO('2026-11-01T12:00', { zone: 'America/New_York' }).toJSDate();
const LESSON_30 = '11111111-0000-0000-0000-000000000030';
const MON_3PM = '2026-11-02T20:00:00.000Z';
const MON_330PM = '2026-11-02T20:30:00.000Z';
const TUE_3PM = '2026-11-03T20:00:00.000Z';

afterEach(() => vi.restoreAllMocks());

function setup(fail = false) {
	const store = new MemoryBookingStore(demoData());
	const sent: EmailMessage[] = [];
	const mailer: Mailer = {
		async send(msg) {
			if (fail) throw new Error('smtp down');
			sent.push(msg);
		}
	};
	const deps: AdminDeps = { store, mailer, appUrl: 'https://example.test' };
	return { store, sent, deps };
}

async function book(store: MemoryBookingStore, startsAt: string, email = 'gina@example.com') {
	return store.requestGuestBooking(
		{
			email,
			accountName: 'Gina Guest',
			studentName: 'Gabe',
			lessonTypeId: LESSON_30,
			startsAt: new Date(startsAt),
			note: ''
		},
		now
	);
}

describe('admin service', () => {
	it('lists pending requests with labels', async () => {
		const { store } = setup();
		await book(store, TUE_3PM, 'b@example.com');
		await book(store, MON_3PM);
		const views = await listPendingRequests(store, now);
		expect(views.map((v) => v.startsAt.toISOString())).toEqual([MON_3PM, TUE_3PM]);
		expect(views[0].whenLabel).toBe('Monday, November 2, 2026 at 3:00 PM EST');
		expect(views[0].priceLabel).toBe('$35.00');
		expect(views[0].paid).toBe(false);
	});

	it('approve sends confirmed email with ics', async () => {
		const { store, sent, deps } = setup();
		const created = await book(store, MON_3PM);
		const r = await decideRequest(deps, created.bookingId, 'approved', 'ignored', now);
		expect(r).toEqual({ ok: true });
		expect(sent).toHaveLength(1);
		expect(sent[0].to).toBe('gina@example.com');
		expect(sent[0].subject).toContain('Lesson confirmed');
		expect(sent[0].attachments?.[0].filename).toBe('lesson.ics');
		expect(sent[0].text).toContain(`https://example.test/manage/${created.manageToken}`);
		expect((await store.getBooking(created.bookingId))!.status).toBe('approved');
		expect((await store.getBooking(created.bookingId))!.declineReason).toBeNull();
	});

	it("approve email and ics use the booked duration after the lesson type's duration changes", async () => {
		const { store, sent, deps } = setup();
		const created = await book(store, MON_3PM);
		const type = (await store.listAllLessonTypes()).find((t) => t.id === LESSON_30)!;
		await store.updateLessonType(LESSON_30, { ...type, durationMin: 90 });
		await decideRequest(deps, created.bookingId, 'approved', '', now);
		const ics = sent[0].attachments![0].content;
		expect(ics).toContain('DTSTART:20261102T200000Z');
		expect(ics).toContain('DTEND:20261102T203000Z');
		expect(sent[0].text).toContain(', 30 min)');
		expect(sent[0].text).not.toContain('90 min');
	});

	it('decline sends declined email with reason', async () => {
		const { store, sent, deps } = setup();
		const created = await book(store, MON_3PM);
		const r = await decideRequest(deps, created.bookingId, 'declined', '  Away that day  ', now);
		expect(r).toEqual({ ok: true });
		expect(sent).toHaveLength(1);
		expect(sent[0].subject).toContain('declined');
		expect(sent[0].text).toContain('Reason: Away that day');
		expect((await store.getBooking(created.bookingId))!.declineReason).toBe('Away that day');
	});

	it('decline with blank reason sends no reason', async () => {
		const { store, sent, deps } = setup();
		const created = await book(store, MON_3PM);
		await decideRequest(deps, created.bookingId, 'declined', '   ', now);
		expect(sent[0].text).not.toContain('Reason:');
		expect((await store.getBooking(created.bookingId))!.declineReason).toBeNull();
	});

	it('decide on handled request returns message and sends nothing', async () => {
		const { store, sent, deps } = setup();
		const created = await book(store, MON_3PM);
		await decideRequest(deps, created.bookingId, 'declined', '', now);
		sent.length = 0;
		const r = await decideRequest(deps, created.bookingId, 'approved', '', now);
		expect(r).toEqual({ ok: false, message: 'This request was already handled.' });
		expect(sent).toHaveLength(0);
	});

	it('unknown booking returns not found message', async () => {
		const { deps, sent } = setup();
		const r = await decideRequest(deps, 'missing', 'approved', '', now);
		expect(r).toEqual({ ok: false, message: 'Booking not found.' });
		expect(sent).toHaveLength(0);
	});

	it('approve in the past returns message', async () => {
		const { store, sent, deps } = setup();
		const created = await book(store, MON_3PM);
		const later = new Date('2026-11-02T21:00:00.000Z');
		const r = await decideRequest(deps, created.bookingId, 'approved', '', later);
		expect(r).toEqual({ ok: false, message: 'This lesson time has already passed.' });
		expect(sent).toHaveLength(0);
	});

	it('email failure does not fail decision', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { store, deps } = setup(true);
		const a = await book(store, MON_3PM);
		const b = await book(store, TUE_3PM);
		expect(await decideRequest(deps, a.bookingId, 'approved', '', now)).toEqual({ ok: true });
		expect(await decideRequest(deps, b.bookingId, 'declined', 'No', now)).toEqual({ ok: true });
		expect(spy).toHaveBeenCalledTimes(2);
		expect((await store.getBooking(a.bookingId))!.status).toBe('approved');
	});

	it('a settings failure after the decision commits only logs', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { store, sent, deps } = setup();
		const created = await book(store, MON_3PM);
		vi.spyOn(store, 'getSettings').mockRejectedValue(new Error('db down'));
		expect(await decideRequest(deps, created.bookingId, 'approved', '', now)).toEqual({
			ok: true
		});
		expect(spy).toHaveBeenCalledOnce();
		expect(sent).toHaveLength(0);
		expect((await store.getBooking(created.bookingId))!.status).toBe('approved');
	});

	it('reason too long rejected', async () => {
		const { store, sent, deps } = setup();
		const created = await book(store, MON_3PM);
		const r = await decideRequest(deps, created.bookingId, 'declined', 'x'.repeat(501), now);
		expect(r).toEqual({ ok: false, message: 'Reason must be 500 characters or fewer.' });
		expect(sent).toHaveLength(0);
		expect((await store.getBooking(created.bookingId))!.status).toBe('pending');
		const ok = await decideRequest(deps, created.bookingId, 'declined', 'x'.repeat(500), now);
		expect(ok).toEqual({ ok: true });
	});

	it('long reason is ignored on approve', async () => {
		const { store, deps } = setup();
		const created = await book(store, MON_3PM);
		const r = await decideRequest(deps, created.bookingId, 'approved', 'x'.repeat(900), now);
		expect(r).toEqual({ ok: true });
	});

	it('lists upcoming and past lessons', async () => {
		const { store, deps } = setup();
		const a = await book(store, MON_3PM);
		const b = await book(store, MON_330PM, 'b@example.com');
		const c = await book(store, TUE_3PM, 'c@example.com');
		await book(store, '2026-11-04T20:00:00.000Z', 'd@example.com'); // stays pending
		for (const x of [a, b, c]) await decideRequest(deps, x.bookingId, 'approved', '', now);
		const later = new Date('2026-11-02T20:45:00.000Z');
		const upcoming = await listLessons(store, { range: 'upcoming', unpaidOnly: false }, later);
		expect(upcoming.map((v) => v.id)).toEqual([c.bookingId]);
		const past = await listLessons(store, { range: 'past', unpaidOnly: false }, later);
		expect(past.map((v) => v.id)).toEqual([b.bookingId, a.bookingId]);
	});

	it('unpaid filter', async () => {
		const { store, deps } = setup();
		const a = await book(store, MON_3PM);
		const b = await book(store, MON_330PM, 'b@example.com');
		for (const x of [a, b]) await decideRequest(deps, x.bookingId, 'approved', '', now);
		await setLessonPaid(store, a.bookingId, true, now);
		const all = await listLessons(store, { range: 'upcoming', unpaidOnly: false }, now);
		expect(all.map((v) => v.paid)).toEqual([true, false]);
		const unpaid = await listLessons(store, { range: 'upcoming', unpaidOnly: true }, now);
		expect(unpaid.map((v) => v.id)).toEqual([b.bookingId]);
	});

	it('setLessonPaid toggles', async () => {
		const { store, deps } = setup();
		const a = await book(store, MON_3PM);
		await decideRequest(deps, a.bookingId, 'approved', '', now);
		expect(await setLessonPaid(store, a.bookingId, true, now)).toEqual({ ok: true });
		expect((await store.getBooking(a.bookingId))!.paidAt).toEqual(now);
		expect(await setLessonPaid(store, a.bookingId, false, now)).toEqual({ ok: true });
		expect((await store.getBooking(a.bookingId))!.paidAt).toBeNull();
		expect(await setLessonPaid(store, 'missing', true, now)).toEqual({
			ok: false,
			message: 'Booking not found.'
		});
	});
});
