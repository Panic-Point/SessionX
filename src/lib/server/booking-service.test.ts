import { describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import {
	getManageView,
	getMonthAvailability,
	listLessonTypes,
	listLessonTypesFor,
	submitAccountRequest,
	submitGuestRequest,
	type GuestRequestForm
} from './booking-service';
import type { EmailMessage, Mailer } from './email/mailer';
import { demoData } from './store/demo-data';
import { MemoryBookingStore } from './store/memory';
import { fakeCalendar } from './calendar/fake-client.test-helpers';

const now = DateTime.fromISO('2026-11-01T12:00', { zone: 'America/New_York' }).toJSDate();
const LESSON_30 = '11111111-0000-0000-0000-000000000030';
// Monday 2026-11-02 3:00 PM EST
const MON_3PM = '2026-11-02T20:00:00.000Z';
const MON_330PM = '2026-11-02T20:30:00.000Z';

function fakeMailer(fail = false) {
	const sent: EmailMessage[] = [];
	const mailer: Mailer = {
		async send(msg) {
			if (fail) throw new Error('smtp down');
			sent.push(msg);
		}
	};
	return { mailer, sent };
}

function form(overrides: Partial<GuestRequestForm> = {}): GuestRequestForm {
	return {
		lessonTypeId: LESSON_30,
		startsAt: MON_3PM,
		accountName: 'Gina Guest',
		email: 'gina@example.com',
		studentName: 'Gabe',
		note: '',
		...overrides
	};
}

function setup(fail = false) {
	const store = new MemoryBookingStore();
	const { mailer, sent } = fakeMailer(fail);
	return { store, sent, deps: { store, mailer, appUrl: 'https://example.test' } };
}

describe('booking service', () => {
	it('lists lesson types with guest prices', async () => {
		const views = await listLessonTypes(new MemoryBookingStore());
		expect(views.map((v) => v.priceLabel)).toEqual(['$35.00', '$50.00', '$65.00']);
		expect(views[0].durationMin).toBe(30);
	});

	it('month availability marks Monday slots', async () => {
		const m = await getMonthAvailability(new MemoryBookingStore(), LESSON_30, '2026-11', now);
		expect(m).not.toBeNull();
		expect(m!.timezone).toBe('America/New_York');
		expect(m!.days['2026-11-02'][0]).toEqual({ iso: MON_3PM, label: '3:00 PM' });
		expect(m!.days['2026-11-08']).toEqual([]);
	});

	it("month availability excludes an existing pending booking's slot", async () => {
		const { store, deps } = setup();
		const r = await submitGuestRequest(deps, form(), now);
		expect(r.ok).toBe(true);
		const m = await getMonthAvailability(store, LESSON_30, '2026-11', now);
		const isos = m!.days['2026-11-02'].map((s) => s.iso);
		expect(isos).not.toContain(MON_3PM);
		expect(isos).toContain(MON_330PM);
	});

	it('unknown lesson type returns null', async () => {
		expect(await getMonthAvailability(new MemoryBookingStore(), 'nope', '2026-11', now)).toBeNull();
	});

	it('malformed month returns null', async () => {
		const store = new MemoryBookingStore();
		expect(await getMonthAvailability(store, LESSON_30, '2026-13', now)).toBeNull();
		expect(await getMonthAvailability(store, LESSON_30, 'November', now)).toBeNull();
	});

	it('valid request creates booking and returns token', async () => {
		const { store, deps } = setup();
		const r = await submitGuestRequest(deps, form({ accountName: '  Gina Guest ' }), now);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		const view = await getManageView(store, r.manageToken);
		expect(view?.status).toBe('pending');
		expect(view).not.toHaveProperty('accountName');
	});

	it('sends received email to booker and new-request email to admin', async () => {
		const { deps, sent } = setup();
		const r = await submitGuestRequest(deps, form(), now);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(sent.map((m) => m.to)).toEqual([
			'gina@example.com',
			'admin@sessionx.local',
			'gina@example.com'
		]);
		expect(sent[0].subject).toContain('Lesson request received');
		expect(sent[1].subject).toContain('New lesson request');
		const url = `https://example.test/manage/${r.manageToken}`;
		expect(sent[0].text).toContain(url);
		expect(sent[1].text).toContain('https://example.test/admin');
	});

	it('invites a guest without a password to register, with their email filled in', async () => {
		const { deps, sent } = setup();
		await submitGuestRequest(deps, form({ email: ' Gina@Example.com ' }), now);
		const invite = sent.find((m) => m.subject === 'Create your SessionX account');
		expect(invite?.to).toBe('Gina@Example.com');
		expect(invite?.text).toContain('https://example.test/register?email=gina%40example.com');
	});

	it('does not invite a guest whose email already has a password', async () => {
		const { deps, sent } = setup();
		const r = await submitGuestRequest(deps, form({ email: 'parent@example.com' }), now);
		expect(r.ok).toBe(true);
		expect(sent.map((m) => m.subject)).not.toContain('Create your SessionX account');
	});

	it('invites an existing guest account that has no password yet', async () => {
		const { deps, sent } = setup();
		await submitGuestRequest(deps, form(), now);
		sent.length = 0;
		await submitGuestRequest(deps, form({ startsAt: MON_330PM }), now);
		expect(sent.map((m) => m.subject)).toContain('Create your SessionX account');
	});

	it('required field errors', async () => {
		const { deps } = setup();
		const r = await submitGuestRequest(
			deps,
			form({ accountName: ' ', email: 'bad', studentName: '', note: 'x'.repeat(1001) }),
			now
		);
		expect(r).toEqual({
			ok: false,
			errors: {
				accountName: 'Please enter your name.',
				email: 'Please enter a valid email address.',
				studentName: 'Please enter who the lesson is for.',
				note: 'Notes must be 1000 characters or fewer.'
			}
		});
	});

	it('rejects start time that is not an offered slot', async () => {
		const { deps } = setup();
		const message = 'Sorry, that time is no longer available. Please pick another.';
		for (const startsAt of [
			'2026-11-02T20:10:00.000Z',
			'2026-11-08T20:00:00.000Z',
			'2026-10-30T20:00:00.000Z',
			'garbage'
		]) {
			const r = await submitGuestRequest(deps, form({ startsAt }), now);
			expect(r).toEqual({ ok: false, errors: { startsAt: message } });
		}
	});

	it('maps slot_taken to friendly message', async () => {
		const { deps } = setup();
		expect((await submitGuestRequest(deps, form(), now)).ok).toBe(true);
		const r = await submitGuestRequest(deps, form({ email: 'other@example.com' }), now);
		expect(r).toEqual({
			ok: false,
			errors: { startsAt: 'Sorry, that time is no longer available. Please pick another.' }
		});
	});

	it('maps too_many_pending to email error', async () => {
		const { deps } = setup();
		const email = 'parent@example.com';
		expect((await submitGuestRequest(deps, form({ email }), now)).ok).toBe(true);
		expect((await submitGuestRequest(deps, form({ email, startsAt: MON_330PM }), now)).ok).toBe(
			true
		);
		const r = await submitGuestRequest(
			deps,
			form({ email, startsAt: '2026-11-02T21:00:00.000Z' }),
			now
		);
		expect(r).toEqual({
			ok: false,
			errors: {
				email:
					'You already have 2 lesson requests waiting for approval. Please wait for a reply before requesting more.'
			}
		});
	});

	it('maps unknown lesson type to friendly message', async () => {
		const { deps } = setup();
		const r = await submitGuestRequest(deps, form({ lessonTypeId: 'nope' }), now);
		expect(r).toEqual({
			ok: false,
			errors: { startsAt: 'That lesson type is no longer available.' }
		});
	});

	it('succeeds when email sending fails', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { deps } = setup(true);
		const r = await submitGuestRequest(deps, form(), now);
		expect(r.ok).toBe(true);
		expect(spy).toHaveBeenCalledTimes(3);
		spy.mockRestore();
	});

	it('manage view shows status and formatted time', async () => {
		const { store, deps } = setup();
		const r = await submitGuestRequest(deps, form(), now);
		if (!r.ok) throw new Error('expected ok');
		const view = await getManageView(store, r.manageToken);
		expect(view?.status).toBe('pending');
		expect(view?.timezone).toBe('America/New_York');
		expect(view?.whenLabel).toBe('Monday, November 2, 2026 at 3:00 PM EST');
		expect(view?.priceLabel).toBe('$35.00');
		expect(await getManageView(store, 'missing')).toBeNull();
	});
});

const PAT = '22222222-0000-0000-0000-00000000000b';
const AVA = '33333333-0000-0000-0000-0000000000a1';
const BEN = '33333333-0000-0000-0000-0000000000b1';

describe('signed-in booking', () => {
	it("lists lesson types with the student's custom price", async () => {
		const store = new MemoryBookingStore();
		const ben = await listLessonTypesFor(store, { accountId: PAT, studentId: BEN });
		const ava = await listLessonTypesFor(store, { accountId: PAT, studentId: AVA });
		expect(ben![0].priceLabel).toBe('$30.00');
		expect(ava![0].priceLabel).toBe('$35.00');
		expect((await listLessonTypesFor(store, null))![0].priceLabel).toBe('$35.00');
	});

	it("returns null for another account's student", async () => {
		const store = new MemoryBookingStore();
		expect(
			await listLessonTypesFor(store, { accountId: 'someone-else', studentId: BEN })
		).toBeNull();
	});

	it('month availability uses student price', async () => {
		const m = await getMonthAvailability(new MemoryBookingStore(), LESSON_30, '2026-11', now, {
			accountId: PAT,
			studentId: BEN
		});
		expect(m!.lessonType.priceLabel).toBe('$30.00');
	});

	it('submits account request at custom price', async () => {
		const { deps } = setup();
		const r = await submitAccountRequest(
			deps,
			PAT,
			{ lessonTypeId: LESSON_30, startsAt: MON_3PM, studentId: BEN, note: '' },
			now
		);
		expect(r.ok).toBe(true);
		const view = await getManageView(deps.store, (r as { manageToken: string }).manageToken);
		expect(view!.priceCents).toBe(3000);
		expect(view!.studentName).toBe('Ben');
	});

	it('account too_many_pending is a form-level error, not a slot error', async () => {
		const { deps, sent } = setup();
		const req = (startsAt: string, studentId: string) =>
			submitAccountRequest(
				deps,
				PAT,
				{ lessonTypeId: LESSON_30, startsAt, studentId, note: '' },
				now
			);
		expect((await req(MON_3PM, AVA)).ok).toBe(true);
		expect((await req(MON_330PM, BEN)).ok).toBe(true);
		sent.length = 0;
		const r = await req('2026-11-02T21:00:00.000Z', AVA);
		expect(r).toEqual({
			ok: false,
			errors: {
				form: 'You already have 2 lesson requests waiting for approval. Please wait for a reply before requesting more.'
			}
		});
		expect(sent).toEqual([]);
	});

	it('rejects student from another account', async () => {
		const { deps, sent } = setup();
		const r = await submitAccountRequest(
			deps,
			'someone-else',
			{ lessonTypeId: LESSON_30, startsAt: MON_3PM, studentId: BEN, note: '' },
			now
		);
		expect(r).toEqual({ ok: false, errors: { studentId: 'Choose who the lesson is for.' } });
		expect(sent).toEqual([]);
	});

	it('account request emails account and admin with admin link', async () => {
		const { deps, sent } = setup();
		await submitAccountRequest(
			deps,
			PAT,
			{ lessonTypeId: LESSON_30, startsAt: MON_3PM, studentId: AVA, note: 'hi' },
			now
		);
		expect(sent.map((m) => m.to)).toEqual(['parent@example.com', 'admin@sessionx.local']);
		expect(sent[1].text).toContain('https://example.test/admin');
		expect(sent[1].text).not.toContain('/manage/');
	});

	it('guest new-request email links to admin', async () => {
		const { deps, sent } = setup();
		await submitGuestRequest(deps, form(), now);
		expect(sent[1].text).toContain('https://example.test/admin');
		expect(sent[1].text).not.toContain('/manage/');
	});

	it('rejects an unavailable slot and a long note', async () => {
		const { deps } = setup();
		const bad = await submitAccountRequest(
			deps,
			PAT,
			{ lessonTypeId: LESSON_30, startsAt: '2026-11-08T20:00:00.000Z', studentId: AVA, note: '' },
			now
		);
		expect(bad.ok).toBe(false);
		const long = await submitAccountRequest(
			deps,
			PAT,
			{ lessonTypeId: LESSON_30, startsAt: MON_3PM, studentId: AVA, note: 'x'.repeat(1001) },
			now
		);
		expect(long).toEqual({
			ok: false,
			errors: { note: 'Notes must be 1000 characters or fewer.' }
		});
	});

	describe('google calendar busy time', () => {
		const LESSON_60 = '11111111-0000-0000-0000-000000000060';
		const MON_4PM = '2026-11-02T21:00:00.000Z';
		const MON_5PM = '2026-11-02T22:00:00.000Z';
		const MON_6PM = '2026-11-02T23:00:00.000Z';

		function calSetup(bufferMin = 0) {
			const data = demoData();
			data.settings = {
				...data.settings,
				bufferMin,
				gcalWriteCalendarId: 'teacher@example.com',
				gcalBusyCalendarIds: ['teacher@example.com']
			};
			const store = new MemoryBookingStore(data);
			const calendar = fakeCalendar();
			const { mailer } = fakeMailer();
			return { store, calendar, deps: { store, mailer, appUrl: 'https://example.test', calendar } };
		}

		const isosFor = async (
			store: MemoryBookingStore,
			calendar: ReturnType<typeof fakeCalendar>
		) => {
			const m = await getMonthAvailability(store, LESSON_60, '2026-11', now, undefined, calendar);
			return m!.days['2026-11-02'].map((s) => s.iso);
		};

		it('busy calendar time hides slots', async () => {
			const { store, calendar } = calSetup();
			calendar.busyIntervals = [{ start: new Date(MON_3PM), end: new Date(MON_4PM) }];
			const isos = await isosFor(store, calendar);
			expect(isos).not.toContain(MON_3PM);
			expect(isos).not.toContain(MON_330PM);
			expect(isos).toContain(MON_4PM);
		});

		it('buffer applies around calendar busy time', async () => {
			const { store, calendar } = calSetup(30);
			calendar.busyIntervals = [{ start: new Date(MON_5PM), end: new Date(MON_6PM) }];
			const isos = await isosFor(store, calendar);
			// 3:30-4:30 PM plus a 30 minute buffer ends exactly when the busy time starts.
			expect(isos).toContain(MON_330PM);
			// 4:00-5:00 PM would butt up against the busy time with no buffer.
			expect(isos).not.toContain(MON_4PM);
			// 6:00 PM is inside the buffer after the busy time; 6:30 PM is clear.
			expect(isos).not.toContain(MON_6PM);
			expect(isos).toContain('2026-11-02T23:30:00.000Z');
		});

		it('availability fails open when calendar errors', async () => {
			const err = vi.spyOn(console, 'error').mockImplementation(() => {});
			const { store, calendar } = calSetup();
			calendar.fail.busy = true;
			expect(await isosFor(store, calendar)).toContain(MON_3PM);
			expect(err).toHaveBeenCalled();
			err.mockRestore();
		});

		it('submit rejects a slot that is busy on the calendar', async () => {
			const { store, calendar, deps } = calSetup();
			calendar.busyIntervals = [{ start: new Date(MON_3PM), end: new Date(MON_4PM) }];
			const r = await submitGuestRequest(deps, form(), now);
			expect(r).toEqual({
				ok: false,
				errors: { startsAt: 'Sorry, that time is no longer available. Please pick another.' }
			});
			expect(await store.getLiveBookings(new Date(0), new Date('2100-01-01'))).toEqual([]);
		});

		it('submit succeeds when calendar errors', async () => {
			const err = vi.spyOn(console, 'error').mockImplementation(() => {});
			const { calendar, deps } = calSetup();
			calendar.fail.busy = true;
			const r = await submitGuestRequest(deps, form(), now);
			expect(r.ok).toBe(true);
			expect(err).toHaveBeenCalled();
			err.mockRestore();
		});
	});
});
