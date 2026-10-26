import { describe, expect, it } from 'vitest';
import type { StudioSettings } from '../store/types';
import { checkCalendarConnection } from './check';
import { fakeCalendar } from './fake-client.test-helpers';

const settings: StudioSettings = {
	timezone: 'America/New_York',
	minNoticeHours: 24,
	maxAdvanceDays: 60,
	slotIncrementMin: 30,
	bufferMin: 15,
	allowSameDay: false,
	cancelCutoffHours: 48,
	cancellationPolicyText: '',
	adminEmail: null,
	gcalWriteCalendarId: 'lessons@x.com',
	gcalBusyCalendarIds: ['personal@x.com', 'lessons@x.com']
};
const now = new Date('2026-10-26T12:00:00Z');

describe('checkCalendarConnection', () => {
	it('reports the server is not configured when the client is disabled', async () => {
		const calendar = fakeCalendar(false);
		expect(await checkCalendarConnection(calendar, settings, now)).toEqual({
			ok: false,
			lines: ['Google Calendar is not configured on the server (GOOGLE_SERVICE_ACCOUNT_JSON).']
		});
		expect(calendar.busyCalls).toEqual([]);
	});

	it('checks each calendar once over the next 24 hours', async () => {
		const calendar = fakeCalendar();
		const result = await checkCalendarConnection(calendar, settings, now);
		expect(result).toEqual({
			ok: true,
			lines: ['lessons@x.com: OK', 'personal@x.com: OK']
		});
		expect(calendar.busyCalls).toEqual([
			{
				calendarIds: ['lessons@x.com'],
				from: now,
				to: new Date('2026-10-27T12:00:00Z')
			},
			{
				calendarIds: ['personal@x.com'],
				from: now,
				to: new Date('2026-10-27T12:00:00Z')
			}
		]);
	});

	it('reports a per-calendar error line and is not ok when any calendar fails', async () => {
		const calendar = fakeCalendar();
		calendar.busy = async (ids) => {
			if (ids[0] === 'personal@x.com') {
				throw new Error('Free/busy failed for calendar personal@x.com: notFound');
			}
			return [];
		};
		const result = await checkCalendarConnection(calendar, settings, now);
		expect(result).toEqual({
			ok: false,
			lines: [
				'lessons@x.com: OK',
				'personal@x.com: Free/busy failed for calendar personal@x.com: notFound'
			]
		});
	});

	it('says so when no calendars are set', async () => {
		const result = await checkCalendarConnection(
			fakeCalendar(),
			{ ...settings, gcalWriteCalendarId: null, gcalBusyCalendarIds: [] },
			now
		);
		expect(result.ok).toBe(false);
		expect(result.lines).toEqual([
			'No calendars are set. Enter a lesson calendar or busy calendars and save first.'
		]);
	});

	it('never includes key material, even when the error message does', async () => {
		const calendar = fakeCalendar();
		calendar.busy = async () => {
			throw new Error(
				'boom -----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY----- done'
			);
		};
		const result = await checkCalendarConnection(calendar, settings, now);
		const text = result.lines.join('\n');
		expect(text).not.toContain('PRIVATE KEY');
		expect(text).not.toContain('MIIEvQIBADANBg');
		expect(result.lines[0]).toMatch(/^lessons@x.com: /);
	});

	it('uses a generic line for non-Error throws', async () => {
		const calendar = fakeCalendar();
		calendar.busy = async () => {
			throw 'weird';
		};
		const result = await checkCalendarConnection(
			calendar,
			{ ...settings, gcalBusyCalendarIds: [] },
			now
		);
		expect(result).toEqual({ ok: false, lines: ['lessons@x.com: Could not reach the calendar.'] });
	});
});
