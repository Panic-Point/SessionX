import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import {
	decideRequest,
	getFamily,
	listFamilies,
	listLessons,
	listPendingRequests,
	saveAccountNotes,
	saveStudentNotes,
	saveStudentPrices,
	setLessonPaid,
	summarizeLessons,
	type AdminDeps
} from './admin-service';
import { parsePeriod } from './periods';
import type { EmailMessage, Mailer } from './email/mailer';
import { demoData } from './store/demo-data';
import { MemoryBookingStore } from './store/memory';
import { fakeCalendar } from './calendar/fake-client.test-helpers';

const now = DateTime.fromISO('2026-11-01T12:00', { zone: 'America/New_York' }).toJSDate();
const LESSON_30 = '11111111-0000-0000-0000-000000000030';
const PAT = '22222222-0000-0000-0000-00000000000b';
const ADMIN = '22222222-0000-0000-0000-00000000000a';
const AVA = '33333333-0000-0000-0000-0000000000a1';
const LESSON_45 = '11111111-0000-0000-0000-000000000045';
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

	it('lists a period ascending, at local midnight boundaries, combined with unpaid', async () => {
		const { store, deps } = setup();
		const week = parsePeriod(
			new URLSearchParams('period=week&date=2026-11-02'),
			'America/New_York',
			now
		)!.range!;
		const midnightStart = await book(store, '2026-11-02T05:00:00.000Z'); // Mon 12:00am EST
		const a = await book(store, MON_3PM, 'a@example.com');
		const b = await book(store, TUE_3PM, 'b@example.com');
		const nextWeek = await book(store, '2026-11-09T05:00:00.000Z', 'c@example.com');
		const before = await book(store, '2026-11-02T03:00:00.000Z', 'd@example.com');
		await book(store, '2026-11-04T20:00:00.000Z', 'e@example.com'); // stays pending
		for (const x of [midnightStart, a, b, nextWeek, before]) {
			await decideRequest(deps, x.bookingId, 'approved', '', now);
		}
		await setLessonPaid(store, a.bookingId, true, now);
		const later = new Date('2026-11-03T12:00:00.000Z');
		const all = await listLessons(
			store,
			{ range: 'upcoming', unpaidOnly: false, period: week },
			later
		);
		expect(all.map((v) => v.id)).toEqual([midnightStart.bookingId, a.bookingId, b.bookingId]);
		expect(summarizeLessons(all)).toBe('3 lessons · $105.00, $70.00 unpaid');
		const unpaid = await listLessons(
			store,
			{ range: 'upcoming', unpaidOnly: true, period: week },
			later
		);
		expect(unpaid.map((v) => v.id)).toEqual([midnightStart.bookingId, b.bookingId]);
		expect(summarizeLessons(unpaid)).toBe('2 lessons · $70.00, $70.00 unpaid');
	});

	it('summarizes lessons and late cancels', () => {
		expect(summarizeLessons([])).toBe('0 lessons · $0.00');
		const one = { priceCents: 3500, paid: true } as Parameters<typeof summarizeLessons>[0][0];
		expect(summarizeLessons([one])).toBe('1 lesson · $35.00');
		expect(summarizeLessons([one, one], true)).toBe('2 late cancellations · $70.00');
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

	it('lists families without the admin', async () => {
		const { store } = setup();
		const families = await listFamilies(store);
		expect(families.map((f) => f.id)).not.toContain(ADMIN);
		const pat = families.find((f) => f.id === PAT)!;
		expect(pat.email).toBe('parent@example.com');
		expect(pat.studentNames).toContain('Ava');
	});

	it('family view shows custom and blank prices', async () => {
		const { store } = setup();
		await store.setStudentPrice(AVA, LESSON_30, 3000);
		const family = (await getFamily(store, PAT))!;
		const ava = family.students.find((x) => x.id === AVA)!;
		const p30 = ava.prices.find((p) => p.lessonTypeId === LESSON_30)!;
		const p45 = ava.prices.find((p) => p.lessonTypeId === LESSON_45)!;
		expect(p30.customPrice).toBe('30.00');
		expect(p30.listPriceLabel).toMatch(/^\$\d+\.\d{2}$/);
		expect(p45.customPrice).toBe('');
		expect(ava.prices).toHaveLength((await store.listAllLessonTypes()).length);
		expect(await getFamily(store, 'missing')).toBeNull();
		expect(await getFamily(store, ADMIN)).toBeNull();
	});

	it('saves and clears student prices', async () => {
		const { store } = setup();
		expect(await saveStudentPrices(store, AVA, { [LESSON_30]: '30', [LESSON_45]: '42.5' })).toEqual(
			{ ok: true, value: null }
		);
		let ava = (await getFamily(store, PAT))!.students.find((x) => x.id === AVA)!;
		expect(ava.prices.find((p) => p.lessonTypeId === LESSON_30)!.customPrice).toBe('30.00');
		expect(ava.prices.find((p) => p.lessonTypeId === LESSON_45)!.customPrice).toBe('42.50');
		await saveStudentPrices(store, AVA, { [LESSON_30]: '', [LESSON_45]: '42.50' });
		ava = (await getFamily(store, PAT))!.students.find((x) => x.id === AVA)!;
		expect(ava.prices.find((p) => p.lessonTypeId === LESSON_30)!.customPrice).toBe('');
		expect(ava.prices.find((p) => p.lessonTypeId === LESSON_45)!.customPrice).toBe('42.50');
	});

	it('invalid price saves nothing', async () => {
		const { store } = setup();
		const r = await saveStudentPrices(store, AVA, {
			[LESSON_30]: '30',
			[LESSON_45]: 'abc',
			bogus: '5'
		});
		expect(r).toEqual({
			ok: false,
			errors: { [LESSON_45]: 'Enter a price like 35 or 35.00.', bogus: 'Unknown lesson type.' }
		});
		const tooHigh = await saveStudentPrices(store, AVA, { [LESSON_30]: '1000.01' });
		expect(tooHigh.ok).toBe(false);
		const ava = (await getFamily(store, PAT))!.students.find((x) => x.id === AVA)!;
		expect(ava.prices.every((p) => p.customPrice === '')).toBe(true);
		expect(await saveStudentPrices(store, 'missing', { [LESSON_30]: '30' })).toEqual({
			ok: false,
			errors: { form: 'Student not found.' }
		});
	});

	it('saves notes and enforces the length limit', async () => {
		const { store } = setup();
		expect(await saveAccountNotes(store, PAT, 'Prefers Mondays')).toEqual({
			ok: true,
			value: null
		});
		expect(await saveStudentNotes(store, AVA, 'Grade 3')).toEqual({ ok: true, value: null });
		const family = (await getFamily(store, PAT))!;
		expect(family.adminNotes).toBe('Prefers Mondays');
		expect(family.students.find((x) => x.id === AVA)!.notes).toBe('Grade 3');
		const long = 'x'.repeat(2001);
		const err = { ok: false, errors: { notes: 'Keep notes under 2000 characters.' } };
		expect(await saveAccountNotes(store, PAT, long)).toEqual(err);
		expect(await saveStudentNotes(store, AVA, long)).toEqual(err);
		expect(await saveAccountNotes(store, 'missing', 'hi')).toEqual({
			ok: false,
			errors: { form: 'Family not found.' }
		});
		expect(await saveStudentNotes(store, 'missing', 'hi')).toEqual({
			ok: false,
			errors: { form: 'Student not found.' }
		});
	});

	it('late-cancels range lists only late cancellations', async () => {
		const { store } = setup();
		const mk = (startsAt: string) =>
			store.requestAccountBooking(
				{
					accountId: PAT,
					studentId: AVA,
					lessonTypeId: LESSON_30,
					startsAt: new Date(startsAt),
					note: ''
				},
				now
			);
		const target = (id: string) => ({ kind: 'account' as const, bookingId: id, accountId: PAT });
		const a = await mk(MON_3PM);
		await store.cancelBooking(target(a.bookingId), true, now);
		const b = await mk(TUE_3PM);
		await store.cancelBooking(target(b.bookingId), true, now);
		const c = await mk(MON_330PM);
		await store.cancelBooking(target(c.bookingId), false, now);
		const rows = await listLessons(store, { range: 'late-cancels', unpaidOnly: false }, now);
		expect(rows.map((v) => v.id)).toEqual([b.bookingId, a.bookingId]);
	});

	describe('google calendar', () => {
		async function calSetup(writeId: string | null = 'teacher@example.com') {
			const { store, deps } = setup();
			const settings = await store.getSettings();
			await store.updateSettings({ ...settings, gcalWriteCalendarId: writeId });
			const calendar = fakeCalendar();
			return { store, calendar, deps: { ...deps, calendar } };
		}

		it('approve creates calendar event and stores id', async () => {
			const { store, calendar, deps } = await calSetup();
			const created = await book(store, MON_3PM);
			await decideRequest(deps, created.bookingId, 'approved', '', now);
			expect(calendar.created).toHaveLength(1);
			expect(calendar.created[0].calendarId).toBe('teacher@example.com');
			expect(calendar.created[0].event.start.toISOString()).toBe(MON_3PM);
			expect(calendar.created[0].event.description).toContain('https://example.test/admin/lessons');
			expect((await store.getBooking(created.bookingId))!.gcalEventId).toBe('evt-1');
		});

		it('approve without write calendar does nothing', async () => {
			const { store, calendar, deps } = await calSetup(null);
			const created = await book(store, MON_3PM);
			const r = await decideRequest(deps, created.bookingId, 'approved', '', now);
			expect(r).toEqual({ ok: true });
			expect(calendar.created).toEqual([]);
			expect((await store.getBooking(created.bookingId))!.gcalEventId).toBeNull();
		});

		it('approve succeeds when calendar create fails', async () => {
			const err = vi.spyOn(console, 'error').mockImplementation(() => {});
			const { store, calendar, deps } = await calSetup();
			calendar.fail.create = true;
			const created = await book(store, MON_3PM);
			const r = await decideRequest(deps, created.bookingId, 'approved', '', now);
			expect(r).toEqual({ ok: true });
			expect(err).toHaveBeenCalled();
			const saved = (await store.getBooking(created.bookingId))!;
			expect(saved.status).toBe('approved');
			expect(saved.gcalEventId).toBeNull();
		});

		it('decline never touches calendar', async () => {
			const { store, calendar, deps } = await calSetup();
			const created = await book(store, MON_3PM);
			const r = await decideRequest(deps, created.bookingId, 'declined', 'no', now);
			expect(r).toEqual({ ok: true });
			expect(calendar.created).toEqual([]);
			expect(calendar.deleted).toEqual([]);
			expect(calendar.busyCalls).toEqual([]);
		});
	});
});
