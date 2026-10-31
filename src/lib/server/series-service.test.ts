import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { cancelLesson, getAccountHome } from './account-service';
import { listLessons } from './admin-service';
import { getMonthAvailability } from './booking-service';
import { fakeCalendar, type FakeCalendar } from './calendar/fake-client.test-helpers';
import type { EmailMessage, Mailer } from './email/mailer';
import {
	adminCancelLesson,
	createSeries,
	endSeries,
	getSeriesPage,
	listFamilySeries,
	previewSeries,
	topUpSeries,
	validateSeriesForm,
	type SeriesDeps,
	type SeriesForm
} from './series-service';
import { demoData } from './store/demo-data';
import { MemoryBookingStore } from './store/memory';

const ZONE = 'America/Los_Angeles';
// Sunday, the day US clocks went back.
const now = DateTime.fromISO('2026-11-01T12:00', { zone: ZONE }).toJSDate();
const PAT = '22222222-0000-0000-0000-00000000000b';
const BEN = '33333333-0000-0000-0000-0000000000b1';
const AVA = '33333333-0000-0000-0000-0000000000a1';
const LESSON_30 = '11111111-0000-0000-0000-000000000030';
const LESSON_45 = '11111111-0000-0000-0000-000000000045';
const DEMO_SERIES = '44444444-0000-0000-0000-0000000000b1';
const CALENDAR = 'teacher@example.com';

/** 3:00pm Los Angeles on a date, as a Date. */
const at3pm = (date: string) => DateTime.fromISO(`${date}T15:00`, { zone: ZONE }).toJSDate();
const days = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

afterEach(() => vi.restoreAllMocks());

function form(overrides: Partial<SeriesForm> = {}): SeriesForm {
	return {
		studentId: BEN,
		lessonTypeId: LESSON_30,
		weekday: '2',
		startTime: '15:00',
		intervalWeeks: '1',
		startsOn: '2026-11-02',
		endMode: 'count',
		endsOn: '',
		occurrenceCount: '10',
		note: '',
		notify: 'on',
		...overrides
	};
}

async function setup(opts: { calendar?: FakeCalendar } = {}) {
	const store = new MemoryBookingStore(demoData());
	const calendar = opts.calendar ?? fakeCalendar();
	await store.updateSettings({
		...(await store.getSettings()),
		gcalWriteCalendarId: CALENDAR,
		gcalBusyCalendarIds: [CALENDAR]
	});
	const sent: EmailMessage[] = [];
	const mailer: Mailer = {
		async send(msg) {
			sent.push(msg);
		}
	};
	const deps: SeriesDeps = { store, mailer, appUrl: 'https://example.test', calendar };
	return { store, calendar, sent, deps };
}

async function guestBooking(store: MemoryBookingStore, startsAt: Date) {
	return store.requestGuestBooking(
		{
			email: 'gina@example.com',
			accountName: 'Gina Guest',
			studentName: 'Gabe',
			lessonTypeId: LESSON_30,
			startsAt,
			note: ''
		},
		now
	);
}

describe('validateSeriesForm', () => {
	const today = '2026-11-01';

	it('accepts each way of ending', () => {
		const count = validateSeriesForm(form(), today);
		expect(count).toEqual({
			ok: true,
			value: {
				studentId: BEN,
				lessonTypeId: LESSON_30,
				weekday: 2,
				startTime: '15:00',
				intervalWeeks: 1,
				startsOn: '2026-11-02',
				endsOn: null,
				occurrenceCount: 10,
				note: ''
			}
		});
		const date = validateSeriesForm(form({ endMode: 'date', endsOn: '2027-01-26' }), today);
		expect(date.ok && date.value).toMatchObject({ endsOn: '2027-01-26', occurrenceCount: null });
		const none = validateSeriesForm(form({ endMode: 'none', intervalWeeks: '2' }), today);
		expect(none.ok && none.value).toMatchObject({
			endsOn: null,
			occurrenceCount: null,
			intervalWeeks: 2
		});
	});

	it('reports every bad field', () => {
		const result = validateSeriesForm(
			form({
				studentId: '',
				lessonTypeId: '',
				weekday: '8',
				startTime: '3pm',
				intervalWeeks: '3',
				startsOn: '2026-10-31',
				occurrenceCount: '0',
				note: 'x'.repeat(1001)
			}),
			today
		);
		expect(result.ok).toBe(false);
		expect(!result.ok && Object.keys(result.errors).sort()).toEqual(
			[
				'lessonTypeId',
				'note',
				'occurrenceCount',
				'startTime',
				'startsOn',
				'studentId',
				'weekday',
				'intervalWeeks'
			].sort()
		);
	});

	it('limits the start to the next 12 weeks and the end to after the start', () => {
		const late = validateSeriesForm(form({ startsOn: '2027-01-25' }), today);
		expect(!late.ok && late.errors.startsOn).toBe('Start within the next 12 weeks.');
		const before = validateSeriesForm(
			form({ endMode: 'date', endsOn: '2026-11-01', startsOn: '2026-11-02' }),
			today
		);
		expect(!before.ok && before.errors.endsOn).toMatch(/on or after/);
		// Starts Monday the 2nd; the only Tuesday would be the 3rd.
		const empty = validateSeriesForm(
			form({ endMode: 'date', endsOn: '2026-11-02', startsOn: '2026-11-02' }),
			today
		);
		expect(!empty.ok && empty.errors.endsOn).toMatch(/No lessons/);
		const mode = validateSeriesForm(form({ endMode: '' }), today);
		expect(!mode.ok && mode.errors.endMode).toBeTruthy();
	});
});

describe('previewSeries', () => {
	it('lists "Ben, every Tuesday 3:00pm, 10 lessons from next Tuesday"', async () => {
		const { deps } = await setup();
		const result = await previewSeries(deps, PAT, form(), now);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const p = result.preview;
		expect(p.dates).toHaveLength(10);
		expect(p.dates.every((d) => d.status === 'ok')).toBe(true);
		expect(p.dates[0]).toMatchObject({
			date: '2026-11-03',
			startsAt: at3pm('2026-11-03'),
			whenLabel: 'Tuesday, November 3, 2026 at 3:00 PM PST',
			statusLabel: 'OK'
		});
		expect(p.dates[9].date).toBe('2027-01-05');
		expect(p).toMatchObject({
			bookable: 10,
			scheduleLabel: 'Weekly · Tue 3:00pm',
			studentName: 'Ben',
			lessonTypeName: '30-minute lesson',
			priceLabel: '$30.00',
			endLabel: '10 lessons',
			continues: false,
			through: '2027-01-05'
		});
	});

	it('flags clashes, closed days, Google busy time and past times', async () => {
		const calendar = fakeCalendar();
		calendar.busyIntervals = [
			{ start: at3pm('2026-11-24'), end: new Date(at3pm('2026-11-24').getTime() + 3_600_000) }
		];
		const { store, deps } = await setup({ calendar });
		await guestBooking(store, new Date(at3pm('2026-11-10').getTime() + 15 * 60_000));
		await store.saveDateOverride({ date: '2026-11-17', isClosed: true, ranges: [], note: '' });

		const result = await previewSeries(deps, PAT, form({ occurrenceCount: '5' }), now);
		expect(result.ok && result.preview.dates.map((d) => [d.date, d.status])).toEqual([
			['2026-11-03', 'ok'],
			['2026-11-10', 'clash'],
			['2026-11-17', 'closed'],
			['2026-11-24', 'busy'],
			['2026-12-01', 'ok']
		]);
		expect(result.ok && result.preview.bookable).toBe(2);

		// Today (Sunday) at 9am has already passed.
		const today = await previewSeries(
			deps,
			PAT,
			form({ weekday: '7', startTime: '09:00', startsOn: '2026-11-01', occurrenceCount: '2' }),
			now
		);
		expect(today.ok && today.preview.dates.map((d) => d.status)).toEqual(['past', 'ok']);
	});

	it('keeps 3:00pm local across the spring DST change', async () => {
		const { deps } = await setup();
		const feb = DateTime.fromISO('2027-03-01T12:00', { zone: ZONE }).toJSDate();
		const result = await previewSeries(
			deps,
			PAT,
			form({ startsOn: '2027-03-02', occurrenceCount: '3' }),
			feb
		);
		expect(result.ok && result.preview.dates.map((d) => d.startsAt.toISOString())).toEqual([
			'2027-03-02T23:00:00.000Z',
			'2027-03-09T23:00:00.000Z',
			'2027-03-16T22:00:00.000Z'
		]);
		expect(result.ok && result.preview.dates.every((d) => d.whenLabel.includes('3:00 PM'))).toBe(
			true
		);
	});

	it('covers only 12 weeks of an open-ended series', async () => {
		const { deps } = await setup();
		const result = await previewSeries(deps, PAT, form({ endMode: 'none' }), now);
		expect(result.ok && result.preview).toMatchObject({
			through: '2027-01-24',
			continues: true,
			endLabel: 'No end date'
		});
		expect(result.ok && result.preview.dates).toHaveLength(12);
	});

	it("rejects another family's student and inactive lesson types", async () => {
		const { store, deps } = await setup();
		await guestBooking(store, at3pm('2026-11-04'));
		const gina = (await store.findAccountByEmail('gina@example.com'))!;
		const other = await previewSeries(deps, gina.id, form(), now);
		expect(!other.ok && other.errors.studentId).toBe('Student not found.');

		const lesson = (await store.listAllLessonTypes()).find((t) => t.id === LESSON_45)!;
		await store.updateLessonType(LESSON_45, { ...lesson, active: false });
		const inactive = await previewSeries(deps, PAT, form({ lessonTypeId: LESSON_45 }), now);
		expect(!inactive.ok && inactive.errors.lessonTypeId).toBeTruthy();
	});
});

describe('createSeries', () => {
	it('books 10 approved lessons with one email, one .ics and a calendar event each', async () => {
		const { store, calendar, sent, deps } = await setup();
		const result = await createSeries(deps, PAT, form({ note: 'Scales' }), now);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.booked).toHaveLength(10);
		expect(result.skipped).toEqual([]);

		const lessons = await store.listSeriesBookings(result.seriesId);
		expect(lessons).toHaveLength(10);
		expect(lessons.every((l) => l.status === 'approved' && l.priceCents === 3000)).toBe(true);
		expect(lessons.every((l) => l.note === 'Scales')).toBe(true);
		const upcoming = await store.listBookings({ statuses: ['approved'], from: now, order: 'asc' });
		expect(upcoming).toHaveLength(10);
		expect((await store.listAccountBookings(PAT)).length).toBe(10);

		expect(sent).toHaveLength(1);
		expect(sent[0].to).toBe('parent@example.com');
		expect(sent[0].subject).toBe('Recurring lessons booked – Ben, Weekly · Tue 3:00pm');
		const ics = sent[0].attachments![0].content;
		expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(10);
		expect(ics).toContain(`UID:${lessons[0].id}@sessionx`);
		// The email describes the schedule; each lesson's manage link lives in its calendar event.
		expect(sent[0].text).toContain(
			'Schedule: Weekly on Tuesdays at 3:00 PM, starting November 3, 2026, until January 5, 2027 (10 lessons)'
		);
		expect(sent[0].text).not.toContain('November 10, 2026');
		expect(sent[0].text).not.toContain('/manage/');
		expect(sent[0].text).toContain('https://example.test/account');
		expect(ics.replace(/\r\n /g, '')).toContain(
			`https://example.test/manage/${lessons[0].manageToken}`
		);

		expect(calendar.created).toHaveLength(10);
		expect(calendar.created[0].calendarId).toBe(CALENDAR);
		expect(calendar.created[0].event.start).toEqual(at3pm('2026-11-03'));
		expect((await store.listSeriesBookings(result.seriesId))[0].gcalEventId).toBe('evt-1');
	});

	it('books quietly when emailing is off, still adding calendar events', async () => {
		const { store, calendar, sent, deps } = await setup();
		const result = await createSeries(deps, PAT, form({ notify: '' }), now);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(await store.listSeriesBookings(result.seriesId)).toHaveLength(10);
		expect(sent).toHaveLength(0);
		expect(calendar.created).toHaveLength(10);
	});

	it('skips and reports clashing dates without touching existing bookings', async () => {
		const { store, sent, deps } = await setup();
		const existing = await guestBooking(store, at3pm('2026-11-10'));
		await store.saveDateOverride({ date: '2026-11-17', isClosed: true, ranges: [], note: '' });

		const result = await createSeries(deps, PAT, form({ occurrenceCount: '4' }), now);
		expect(result.ok && result.booked).toEqual([
			'Tuesday, November 3, 2026 at 3:00 PM PST',
			'Tuesday, November 24, 2026 at 3:00 PM PST'
		]);
		expect(result.ok && result.skipped).toEqual([
			{
				whenLabel: 'Tuesday, November 10, 2026 at 3:00 PM PST',
				reason: 'Clashes with an existing lesson'
			},
			{ whenLabel: 'Tuesday, November 17, 2026 at 3:00 PM PST', reason: 'Studio closed that day' }
		]);
		const kept = await store.getBooking(existing.bookingId);
		expect(kept).toMatchObject({ status: 'pending', startsAt: at3pm('2026-11-10'), series: null });
		expect(sent[0].text).toContain('No lesson on these dates:');
		expect(sent[0].text).toContain('Studio closed that day');
	});

	it('reports a date taken between the preview and the save as skipped', async () => {
		const { store, deps } = await setup();
		const original = store.createSeries.bind(store);
		vi.spyOn(store, 'createSeries').mockImplementation(async (...args) => {
			await guestBooking(store, at3pm('2026-11-10'));
			return original(...args);
		});
		const result = await createSeries(deps, PAT, form({ occurrenceCount: '3' }), now);
		expect(result.ok && result.booked).toHaveLength(2);
		expect(result.ok && result.skipped.map((s) => s.reason)).toEqual([
			'Clashes with an existing lesson'
		]);
	});

	it('refuses when no date can be booked', async () => {
		const { store, sent, deps } = await setup();
		await store.saveDateOverride({ date: '2026-11-03', isClosed: true, ranges: [], note: '' });
		const result = await createSeries(deps, PAT, form({ occurrenceCount: '1' }), now);
		expect(result).toEqual({ ok: false, errors: { form: 'None of these dates can be booked.' } });
		expect(await store.listSeriesForAccount(PAT)).toHaveLength(1); // just the demo series
		expect(sent).toEqual([]);
	});

	it('keeps going when email and calendar fail', async () => {
		const calendar = fakeCalendar();
		calendar.fail.create = true;
		const { store, deps } = await setup({ calendar });
		deps.mailer = {
			async send() {
				throw new Error('smtp down');
			}
		};
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const result = await createSeries(deps, PAT, form({ occurrenceCount: '2' }), now);
		expect(result.ok).toBe(true);
		expect(result.ok && (await store.listSeriesBookings(result.seriesId))).toHaveLength(2);
	});

	it('blocks those times on /book', async () => {
		const { store, deps } = await setup();
		await createSeries(deps, PAT, form({ occurrenceCount: '2' }), now);
		const month = await getMonthAvailability(store, LESSON_30, '2026-11', now);
		const tuesday = month!.days['2026-11-03'].map((s) => s.iso);
		expect(tuesday).not.toContain(at3pm('2026-11-03').toISOString());
		expect(tuesday).toContain(new Date(at3pm('2026-11-03').getTime() + 30 * 60_000).toISOString());
	});
});

describe('topUpSeries', () => {
	it('extends an open-ended series day by day, without email', async () => {
		const { store, calendar, sent, deps } = await setup();
		const created = await createSeries(deps, PAT, form({ endMode: 'none' }), now);
		if (!created.ok) throw new Error('create failed');
		expect(await store.listSeriesBookings(created.seriesId)).toHaveLength(12);
		sent.length = 0;
		const eventsBefore = calendar.created.length;

		// Same day: nothing new for this series (the demo series gets its first dates).
		await topUpSeries(deps, now);
		expect(await store.listSeriesBookings(created.seriesId)).toHaveLength(12);

		// Two days later the horizon reaches the next Tuesday.
		const later = days(now, 2);
		const result = await topUpSeries(deps, later);
		const lessons = await store.listSeriesBookings(created.seriesId);
		expect(lessons).toHaveLength(13);
		expect(lessons[12].startsAt).toEqual(at3pm('2027-01-26'));
		expect(result.lessonsAdded).toBeGreaterThanOrEqual(1);
		expect(sent).toEqual([]);
		expect(calendar.created.length).toBeGreaterThan(eventsBefore);
		expect(lessons[12].gcalEventId).not.toBeNull();
	});

	it('does not recreate a lesson the family cancelled', async () => {
		const { store, deps } = await setup();
		const created = await createSeries(deps, PAT, form({ endMode: 'none' }), now);
		if (!created.ok) throw new Error('create failed');
		const [first] = await store.listSeriesBookings(created.seriesId);
		await cancelLesson(deps, { kind: 'account', bookingId: first.id, accountId: PAT }, now);

		await topUpSeries(deps, days(now, 2));
		const lessons = await store.listSeriesBookings(created.seriesId);
		expect(lessons.filter((l) => l.startsAt.getTime() === first.startsAt.getTime())).toHaveLength(
			1
		);
		expect(lessons[0].status).toBe('cancelled');
		expect(lessons.slice(1).every((l) => l.status === 'approved')).toBe(true);
	});

	it('skips a clashing date and moves on', async () => {
		const { store, deps } = await setup();
		const created = await createSeries(deps, PAT, form({ endMode: 'none' }), now);
		if (!created.ok) throw new Error('create failed');
		await guestBooking(store, at3pm('2027-01-26'));
		await topUpSeries(deps, days(now, 2));
		const series = (await store.getSeries(created.seriesId))!;
		expect(series.materializedThrough).toBe('2027-01-26');
		expect(await store.listSeriesBookings(created.seriesId)).toHaveLength(12);
	});

	it('stops at the end of a counted series', async () => {
		const { store, deps } = await setup();
		const created = await createSeries(deps, PAT, form({ occurrenceCount: '13' }), now);
		if (!created.ok) throw new Error('create failed');
		expect(await store.listSeriesBookings(created.seriesId)).toHaveLength(12);
		await topUpSeries(deps, days(now, 30));
		expect(await store.listSeriesBookings(created.seriesId)).toHaveLength(13);
		await topUpSeries(deps, days(now, 60));
		expect(await store.listSeriesBookings(created.seriesId)).toHaveLength(13);
	});

	it('materialises the demo series from today', async () => {
		const { store, deps } = await setup();
		const result = await topUpSeries(deps, now);
		expect(result).toEqual({ series: 1, lessonsAdded: 12, deferred: 0, subrequests: 29 });
		const lessons = await store.listSeriesBookings(DEMO_SERIES);
		expect(lessons[0].startsAt).toEqual(
			DateTime.fromISO('2026-11-03T16:00', { zone: ZONE }).toJSDate()
		);
	});
});

describe('topUpSeries budget', () => {
	it('leaves series past the budget for the next run, but always does the first', async () => {
		const { store, deps } = await setup();
		const a = await createSeries(deps, PAT, form({ endMode: 'none' }), now);
		const b = await createSeries(deps, PAT, form({ endMode: 'none', weekday: '3' }), now);
		if (!a.ok || !b.ok) throw new Error('create failed');
		await topUpSeries(deps, now); // the demo series' first dates
		const later = days(now, 3); // both reach a new date

		const first = await topUpSeries(deps, later, 1);
		expect(first).toMatchObject({ series: 1, lessonsAdded: 1, subrequests: 7 });
		expect(first.deferred).toBeGreaterThan(0);

		const second = await topUpSeries(deps, later);
		expect(second.deferred).toBe(0);
		expect(await store.listSeriesBookings(a.seriesId)).toHaveLength(13);
		expect(await store.listSeriesBookings(b.seriesId)).toHaveLength(13);
	});
});

describe('cancelling', () => {
	async function withSeries() {
		const ctx = await setup();
		const created = await createSeries(ctx.deps, PAT, form({ occurrenceCount: '4' }), now);
		if (!created.ok) throw new Error('create failed');
		ctx.sent.length = 0;
		return { ...ctx, seriesId: created.seriesId };
	}

	it('ending a series cancels future lessons only, emails once, removes events and stops top-ups', async () => {
		const { store, calendar, sent, deps, seriesId } = await withSeries();
		// After the first lesson.
		const later = days(at3pm('2026-11-03'), 1);
		const result = await endSeries(deps, seriesId, null, later);
		expect(result).toEqual({ ok: true, cancelled: 3 });

		const lessons = await store.listSeriesBookings(seriesId);
		expect(lessons.map((l) => l.status)).toEqual([
			'approved',
			'cancelled',
			'cancelled',
			'cancelled'
		]);
		expect(lessons.every((l) => !l.lateCancel)).toBe(true);
		expect(calendar.deleted.map((d) => d.eventId)).toEqual(['evt-2', 'evt-3', 'evt-4']);

		expect(sent).toHaveLength(1);
		expect(sent[0].subject).toBe('Recurring lessons cancelled – Ben, Weekly · Tue 3:00pm');
		expect(sent[0].text).toContain(
			'Cancelled: Every lesson from Tuesday, November 10, 2026 onward (3 lessons)'
		);
		expect(sent[0].text).not.toContain('November 17, 2026');

		const topUp = await topUpSeries(deps, days(later, 30));
		expect(await store.listSeriesBookings(seriesId)).toHaveLength(4);
		expect(topUp.series).toBe(1); // only the demo series
	});

	it('ending from a lesson keeps the ones before it', async () => {
		const { store, deps, seriesId } = await withSeries();
		const lessons = await store.listSeriesBookings(seriesId);
		await endSeries(deps, seriesId, lessons[2].startsAt, now);
		expect((await store.listSeriesBookings(seriesId)).map((l) => l.status)).toEqual([
			'approved',
			'approved',
			'cancelled',
			'cancelled'
		]);
	});

	it('ending a series with nothing left to cancel sends no email', async () => {
		const { sent, deps, seriesId } = await withSeries();
		await endSeries(deps, seriesId, null, now);
		sent.length = 0;
		expect(await endSeries(deps, seriesId, null, now)).toEqual({ ok: true, cancelled: 0 });
		expect(sent).toEqual([]);
		expect(await endSeries(deps, '44444444-0000-0000-0000-0000000000ff', null, now)).toEqual({
			ok: false,
			message: 'Series not found.'
		});
	});

	it('the admin cancels one lesson: never late, family emailed, event removed, rest kept', async () => {
		const { store, calendar, sent, deps, seriesId } = await withSeries();
		const [first] = await store.listSeriesBookings(seriesId);
		// Inside the 24-hour cutoff.
		const result = await adminCancelLesson(deps, first.id, days(first.startsAt, -0.5));
		expect(result).toEqual({ ok: true });
		const lessons = await store.listSeriesBookings(seriesId);
		expect(lessons[0]).toMatchObject({ status: 'cancelled', lateCancel: false });
		expect(lessons.slice(1).every((l) => l.status === 'approved')).toBe(true);
		expect(sent.map((m) => [m.to, m.subject.split(' – ')[0]])).toEqual([
			['parent@example.com', 'Lesson cancelled']
		]);
		expect(calendar.deleted).toEqual([{ calendarId: CALENDAR, eventId: 'evt-1' }]);

		expect(await adminCancelLesson(deps, first.id, now)).toEqual({
			ok: false,
			message: 'This lesson can no longer be cancelled.'
		});
		expect(await adminCancelLesson(deps, 'nope', now)).toEqual({
			ok: false,
			message: 'Lesson not found.'
		});
	});

	it('the admin can tell the family why a lesson was cancelled', async () => {
		const { store, sent, deps, seriesId } = await withSeries();
		const [first, second] = await store.listSeriesBookings(seriesId);
		expect(await adminCancelLesson(deps, first.id, now, 'x'.repeat(501))).toEqual({
			ok: false,
			message: 'Reason must be 500 characters or fewer.'
		});
		expect((await store.getBooking(first.id))?.status).toBe('approved');

		sent.length = 0;
		expect(await adminCancelLesson(deps, second.id, now, '  Teacher is unwell  ')).toEqual({
			ok: true
		});
		expect(sent).toHaveLength(1);
		expect(sent[0].text).toContain('Your teacher has cancelled this lesson.');
		expect(sent[0].text).toContain('Reason: Teacher is unwell');
	});

	it('the admin can cancel a lesson or end a series without emailing the family', async () => {
		const { store, calendar, sent, deps, seriesId } = await withSeries();
		const [first, second] = await store.listSeriesBookings(seriesId);
		expect(await adminCancelLesson(deps, first.id, now, 'Arranged by phone', false)).toEqual({
			ok: true
		});
		expect((await store.getBooking(first.id))?.status).toBe('cancelled');
		expect(calendar.deleted.map((d) => d.eventId)).toEqual(['evt-1']);

		expect(await endSeries(deps, seriesId, second.startsAt, now, false)).toEqual({
			ok: true,
			cancelled: 3
		});
		expect(calendar.deleted.map((d) => d.eventId)).toEqual(['evt-1', 'evt-2', 'evt-3', 'evt-4']);
		expect(sent).toEqual([]);
	});

	it('a family cancelling one lesson uses the usual late rules and keeps the rest', async () => {
		const { store, deps, seriesId } = await withSeries();
		const [first] = await store.listSeriesBookings(seriesId);
		const result = await cancelLesson(
			deps,
			{ kind: 'token', manageToken: first.manageToken },
			days(first.startsAt, -0.5)
		);
		expect(result).toEqual({ ok: true, late: true });
		const lessons = await store.listSeriesBookings(seriesId);
		expect(lessons.map((l) => l.status)).toEqual(['cancelled', 'approved', 'approved', 'approved']);
	});
});

describe('views', () => {
	it('lists a family series and its lessons', async () => {
		const { store, deps } = await setup();
		const created = await createSeries(deps, PAT, form({ occurrenceCount: '3', note: 'Hi' }), now);
		if (!created.ok) throw new Error('create failed');

		const list = await listFamilySeries(store, PAT, now);
		expect(list.map((s) => s.id)).toEqual([created.seriesId, DEMO_SERIES]);
		expect(list[0]).toMatchObject({
			scheduleLabel: 'Weekly · Tue 3:00pm',
			studentName: 'Ben',
			lessonTypeName: '30-minute lesson',
			priceLabel: '$30.00',
			startsOnLabel: 'Tuesday, November 3, 2026',
			endLabel: '3 lessons',
			ended: false,
			upcomingCount: 3,
			note: 'Hi'
		});

		await endSeries(deps, created.seriesId, null, now);
		const page = await getSeriesPage(store, created.seriesId, now);
		expect(page!.series).toMatchObject({ ended: true, upcomingCount: 0 });
		expect(page!.series.endedLabel).toContain('November 1, 2026');
		expect(page!.lessons.map((l) => [l.statusLabel, l.canCancel])).toEqual([
			['Cancelled', false],
			['Cancelled', false],
			['Cancelled', false]
		]);
		expect(await getSeriesPage(store, 'nope', now)).toBeNull();
	});

	it('labels every-2-weeks series and end dates', async () => {
		const { store, deps } = await setup();
		await createSeries(
			deps,
			PAT,
			form({ studentId: AVA, intervalWeeks: '2', endMode: 'date', endsOn: '2026-12-01' }),
			now
		);
		const [latest] = await listFamilySeries(store, PAT, now);
		expect(latest).toMatchObject({
			scheduleLabel: 'Every 2 weeks · Tue 3:00pm',
			endLabel: 'Until Tuesday, December 1, 2026',
			upcomingCount: 3,
			priceLabel: '$35.00'
		});
	});

	it('tags occurrences in the admin Lessons list and on /account', async () => {
		const { store, deps } = await setup();
		await guestBooking(store, at3pm('2026-11-04'));
		const created = await createSeries(
			deps,
			PAT,
			form({ intervalWeeks: '2', occurrenceCount: '2' }),
			now
		);
		if (!created.ok) throw new Error('create failed');
		await store.decideBooking(
			(await store.listBookings({ statuses: ['pending'], order: 'asc' }))[0].id,
			'approved',
			null,
			now
		);

		const lessons = await listLessons(store, { range: 'upcoming', unpaidOnly: false }, now);
		expect(lessons.map((l) => [l.studentName, l.seriesLabel, l.series?.id ?? null])).toEqual([
			['Ben', 'Every 2 weeks · Tue 3:00pm', created.seriesId],
			['Gabe', null, null],
			['Ben', 'Every 2 weeks · Tue 3:00pm', created.seriesId]
		]);

		const home = await getAccountHome(store, PAT, now);
		expect(home.upcoming.map((l) => l.seriesLabel)).toEqual(['Every 2 weeks', 'Every 2 weeks']);
		expect(home.upcoming.every((l) => l.canCancel)).toBe(true);
	});
});
