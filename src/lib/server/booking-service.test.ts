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
import { MemoryBookingStore } from './store/memory';

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
		expect(sent.map((m) => m.to)).toEqual(['gina@example.com', 'admin@sessionx.local']);
		expect(sent[0].subject).toContain('Lesson request received');
		expect(sent[1].subject).toContain('New lesson request');
		const url = `https://example.test/manage/${r.manageToken}`;
		expect(sent[0].text).toContain(url);
		expect(sent[1].text).toContain('https://example.test/admin');
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
		expect(spy).toHaveBeenCalledTimes(2);
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
});
