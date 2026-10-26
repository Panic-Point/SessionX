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

	describe('write-access probe', () => {
		const writeOnly = { ...settings, gcalBusyCalendarIds: [] };

		it('creates then deletes a short test event on the lesson calendar only', async () => {
			const calendar = fakeCalendar();
			const result = await checkCalendarConnection(calendar, settings, now);
			expect(result).toEqual({ ok: true, lines: ['lessons@x.com: OK', 'personal@x.com: OK'] });
			expect(calendar.created).toHaveLength(1);
			expect(calendar.created[0].calendarId).toBe('lessons@x.com');
			const ev = calendar.created[0].event;
			expect(ev.summary).toBe('SessionX connection check');
			expect(ev.start).toEqual(new Date('2026-10-26T13:00:00Z'));
			expect(ev.end).toEqual(new Date('2026-10-26T13:05:00Z'));
			expect(ev.timeZone).toBe('America/New_York');
			expect(calendar.deleted).toEqual([{ calendarId: 'lessons@x.com', eventId: 'evt-1' }]);
		});

		it('never creates events on busy-only calendars', async () => {
			const calendar = fakeCalendar();
			await checkCalendarConnection(
				calendar,
				{ ...settings, gcalWriteCalendarId: null, gcalBusyCalendarIds: ['personal@x.com'] },
				now
			);
			expect(calendar.created).toEqual([]);
			expect(calendar.deleted).toEqual([]);
		});

		it('reports read-only sharing when the test event cannot be created', async () => {
			const calendar = fakeCalendar();
			calendar.fail.create = true;
			const result = await checkCalendarConnection(calendar, writeOnly, now);
			expect(result).toEqual({
				ok: false,
				lines: [
					`lessons@x.com: can read but can't add events — share it with "Make changes to events".`
				]
			});
		});

		it('is still ok but says to delete by hand when the test event cannot be removed', async () => {
			const calendar = fakeCalendar();
			calendar.fail.delete = true;
			const result = await checkCalendarConnection(calendar, writeOnly, now);
			expect(result).toEqual({
				ok: true,
				lines: [
					'lessons@x.com: OK (could not remove the test event — delete "SessionX connection check" by hand)'
				]
			});
		});

		it('does not probe writes when the read fails', async () => {
			const calendar = fakeCalendar();
			calendar.fail.busy = true;
			const result = await checkCalendarConnection(calendar, writeOnly, now);
			expect(result.ok).toBe(false);
			expect(calendar.created).toEqual([]);
		});
	});

	describe('error mapping', () => {
		const readOnly = { ...settings, gcalBusyCalendarIds: [] };
		const lineFor = async (err: Error) => {
			const calendar = fakeCalendar();
			calendar.busy = async () => {
				throw err;
			};
			return (await checkCalendarConnection(calendar, readOnly, now)).lines[0];
		};

		it('maps the invalid-key message to a fix hint without key material', async () => {
			expect(await lineFor(new Error('Google service account private key is invalid'))).toBe(
				"lessons@x.com: The server's Google key is invalid — create a new JSON key (guide step 4) and update GOOGLE_SERVICE_ACCOUNT_JSON."
			);
		});

		it('maps a rejected token exchange', async () => {
			expect(await lineFor(new Error('Google API 400 /token'))).toBe(
				"lessons@x.com: Google rejected the server's key — it may have been deleted; create a new key (guide step 4)."
			);
		});

		it('maps a 403 on free/busy', async () => {
			expect(await lineFor(new Error('Google API 403 /calendar/v3/freeBusy'))).toBe(
				'lessons@x.com: Google refused access — check the Google Calendar API is enabled (guide step 2) and the calendar is shared.'
			);
		});

		it('still redacts other messages that mention a private key', async () => {
			expect(await lineFor(new Error('weird private key MIIEvQ'))).toBe(
				'lessons@x.com: Could not reach the calendar.'
			);
		});
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
