import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoData } from '../store/demo-data';
import type { AdminBooking, StudioSettings } from '../store/types';
import { fakeCalendar } from './fake-client.test-helpers';
import { calendarBusy, lessonEvent } from './sync';

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
