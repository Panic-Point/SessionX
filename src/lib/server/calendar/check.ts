import type { StudioSettings } from '../store/types';
import { INVALID_KEY } from './google';
import type { CalendarClient } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOT_CONFIGURED =
	'Google Calendar is not configured on the server (GOOGLE_SERVICE_ACCOUNT_JSON).';
const NO_CALENDARS =
	'No calendars are set. Enter a lesson calendar or busy calendars and save first.';
const GENERIC_ERROR = 'Could not reach the calendar.';
const TEST_EVENT_SUMMARY = 'SessionX connection check';
const TEST_EVENT_MS = 5 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Error text safe to show the admin: never anything that looks like key material. */
function safeMessage(e: unknown): string {
	if (!(e instanceof Error) || !e.message) return GENERIC_ERROR;
	const m = e.message;
	if (m === INVALID_KEY) {
		return "The server's Google key is invalid — create a new JSON key (guide step 4) and update GOOGLE_SERVICE_ACCOUNT_JSON.";
	}
	if (m === 'Google API 400 /token') {
		return "Google rejected the server's key — it may have been deleted; create a new key (guide step 4).";
	}
	if (m === 'Google API 403 /calendar/v3/freeBusy') {
		return 'Google refused access — check the Google Calendar API is enabled (guide step 2) and the calendar is shared.';
	}
	if (/private[ _]key/i.test(m)) return GENERIC_ERROR;
	return m;
}

/**
 * Reads free/busy for the next 24 hours from each saved calendar (lesson calendar first), one
 * at a time so every calendar gets its own OK or error line. The lesson calendar must also accept
 * a test event, because free/busy succeeds even with read-only sharing.
 */
export async function checkCalendarConnection(
	calendar: CalendarClient,
	settings: StudioSettings,
	now: Date
): Promise<{ ok: boolean; lines: string[] }> {
	if (!calendar.enabled) return { ok: false, lines: [NOT_CONFIGURED] };

	const ids = [
		...new Set(
			[settings.gcalWriteCalendarId, ...settings.gcalBusyCalendarIds].filter(
				(id): id is string => !!id
			)
		)
	];
	if (ids.length === 0) return { ok: false, lines: [NO_CALENDARS] };

	const to = new Date(now.getTime() + DAY_MS);
	const results = await Promise.all(
		ids.map(async (id) => {
			try {
				await calendar.busy([id], now, to);
				if (id === settings.gcalWriteCalendarId)
					return await probeWrite(calendar, settings, id, now);
				return { ok: true, line: `${id}: OK` };
			} catch (e) {
				return { ok: false, line: `${id}: ${safeMessage(e)}` };
			}
		})
	);
	return { ok: results.every((r) => r.ok), lines: results.map((r) => r.line) };
}

/** Creates then removes a short event to prove the lesson calendar is shared with edit rights. */
async function probeWrite(
	calendar: CalendarClient,
	settings: StudioSettings,
	id: string,
	now: Date
): Promise<{ ok: boolean; line: string }> {
	const start = new Date(now.getTime() + HOUR_MS);
	let eventId: string;
	try {
		eventId = await calendar.createEvent(id, {
			summary: TEST_EVENT_SUMMARY,
			description: '',
			start,
			end: new Date(start.getTime() + TEST_EVENT_MS),
			timeZone: settings.timezone
		});
	} catch {
		return {
			ok: false,
			line: `${id}: can read but can't add events — share it with "Make changes to events".`
		};
	}
	try {
		await calendar.deleteEvent(id, eventId);
	} catch {
		return {
			ok: true,
			line: `${id}: OK (could not remove the test event — delete "${TEST_EVENT_SUMMARY}" by hand)`
		};
	}
	return { ok: true, line: `${id}: OK` };
}
