import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoData } from '../store/demo-data';
import { MemoryBookingStore } from '../store/memory';
import type { AdminBooking, StudioSettings } from '../store/types';
import { fakeCalendar } from './fake-client.test-helpers';
import { calendarBusy, lessonEvent, SYNC_BATCH_SIZE, syncLessonsToCalendar } from './sync';

afterEach(() => vi.restoreAllMocks());

const settings: StudioSettings = {
	...demoData().settings,
	gcalWriteCalendarId: 'teacher@example.com',
	gcalBusyCalendarIds: ['teacher@example.com']
};
const from = new Date('2026-11-01T05:00:00Z');
const to = new Date('2026-12-01T05:00:00Z');

const booking: AdminBooking = {
	id: 'b1',
	status: 'approved',
	startsAt: new Date('2026-11-02T20:00:00Z'),
	endsAt: new Date('2026-11-02T20:30:00Z'),
	lessonTypeName: '30 minute lesson',
	durationMin: 30,
	studentName: 'Ava',
	accountName: 'Pat Parent',
	accountEmail: 'parent@example.com',
	priceCents: 3500,
	paidAt: null,
	note: 'Bring the red book',
	declineReason: null,
	lateCancel: false,
	manageToken: 'secret-token',
	gcalEventId: null,
	series: null
};

describe('calendarBusy', () => {
	it('returns [] when disabled', async () => {
		const cal = fakeCalendar(false);
		expect(await calendarBusy(cal, settings, from, to)).toEqual([]);
		expect(await calendarBusy(undefined, settings, from, to)).toEqual([]);
		expect(cal.busyCalls).toEqual([]);
	});

	it('returns [] without calling when no busy calendars are configured', async () => {
		const cal = fakeCalendar();
		expect(await calendarBusy(cal, { ...settings, gcalBusyCalendarIds: [] }, from, to)).toEqual([]);
		expect(cal.busyCalls).toEqual([]);
	});

	it('returns the busy intervals', async () => {
		const cal = fakeCalendar();
		cal.busyIntervals = [{ start: from, end: to }];
		expect(await calendarBusy(cal, settings, from, to)).toEqual([{ start: from, end: to }]);
		expect(cal.busyCalls[0].calendarIds).toEqual(['teacher@example.com']);
	});

	it('fails open and logs', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		const cal = fakeCalendar();
		cal.fail.busy = true;
		expect(await calendarBusy(cal, settings, from, to)).toEqual([]);
		expect(err).toHaveBeenCalled();
	});
});

describe('lessonEvent', () => {
	it('has exact summary, times, description, and no family manage link', () => {
		const e = lessonEvent(booking, settings, 'https://example.test');
		expect(e.summary).toBe('30 minute lesson – Ava');
		expect(e.start).toEqual(booking.startsAt);
		expect(e.end).toEqual(booking.endsAt);
		expect(e.timeZone).toBe(settings.timezone);
		expect(e.description).toBe(
			[
				'Booked by Pat Parent (parent@example.com)',
				'Bring the red book',
				'Manage in SessionX: https://example.test/admin/lessons'
			].join('\n')
		);
		expect(e.description).not.toContain('/manage/');
		expect(e.description).not.toContain('secret-token');
	});

	it('omits the note line when the note is empty', () => {
		const e = lessonEvent({ ...booking, note: '' }, settings, 'https://example.test');
		expect(e.description).toBe(
			[
				'Booked by Pat Parent (parent@example.com)',
				'Manage in SessionX: https://example.test/admin/lessons'
			].join('\n')
		);
	});
});

describe('syncLessonsToCalendar', () => {
	const PARENT = '22222222-0000-0000-0000-00000000000b';
	const AVA = '33333333-0000-0000-0000-0000000000a1';
	const LESSON_30 = '11111111-0000-0000-0000-000000000030';
	const now = new Date('2026-11-01T12:00:00Z');
	// Mondays 3pm Los Angeles, one week apart, starting the day after `now`.
	const weekly = (i: number) => new Date(Date.UTC(2026, 10, 2 + 7 * i, 23, 0));

	async function setup(lessons: number) {
		const store = new MemoryBookingStore(demoData());
		await store.updateSettings({
			...(await store.getSettings()),
			gcalWriteCalendarId: 'studio@x.com'
		});
		const ids: string[] = [];
		for (let i = 0; i < lessons; i++) {
			const created = await store.createApprovedBooking(
				{
					accountId: PARENT,
					studentId: AVA,
					lessonTypeId: LESSON_30,
					startsAt: weekly(i),
					note: ''
				},
				now
			);
			ids.push(created.bookingId);
		}
		const calendar = fakeCalendar();
		const deps = { store, calendar, appUrl: 'https://example.test' };
		return { store, calendar, deps, ids, settings: await store.getSettings() };
	}

	it('adds upcoming lessons without an event and skips ones already synced', async () => {
		const { store, calendar, deps, ids, settings } = await setup(3);
		await store.setCalendarEventId(ids[0], 'existing');

		expect(await syncLessonsToCalendar(deps, settings, now)).toEqual({
			added: 2,
			failed: 0,
			remaining: 0
		});
		expect(calendar.created.map((c) => c.calendarId)).toEqual(['studio@x.com', 'studio@x.com']);
		expect((await store.getBooking(ids[1]))?.gcalEventId).toBe('evt-1');

		expect(await syncLessonsToCalendar(deps, settings, now)).toEqual({
			added: 0,
			failed: 0,
			remaining: 0
		});
		expect(calendar.created).toHaveLength(2);
	});

	it('leaves past lessons alone', async () => {
		const { calendar, deps, settings } = await setup(2);
		const later = new Date(weekly(0).getTime() + 1);
		expect(await syncLessonsToCalendar(deps, settings, later)).toEqual({
			added: 1,
			failed: 0,
			remaining: 0
		});
		expect(calendar.created[0].event.start).toEqual(weekly(1));
	});

	it('adds at most one batch per run and reports what is left', async () => {
		const { calendar, deps, settings } = await setup(SYNC_BATCH_SIZE + 2);
		expect(await syncLessonsToCalendar(deps, settings, now)).toEqual({
			added: SYNC_BATCH_SIZE,
			failed: 0,
			remaining: 2
		});
		expect(await syncLessonsToCalendar(deps, settings, now)).toEqual({
			added: 2,
			failed: 0,
			remaining: 0
		});
		expect(calendar.created).toHaveLength(SYNC_BATCH_SIZE + 2);
	});

	it('counts failures and leaves them to retry', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { calendar, deps, settings } = await setup(2);
		calendar.fail.create = true;
		expect(await syncLessonsToCalendar(deps, settings, now)).toEqual({
			added: 0,
			failed: 2,
			remaining: 2
		});
	});
});
