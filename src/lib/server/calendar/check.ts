import type { StudioSettings } from '../store/types';
import type { CalendarClient } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOT_CONFIGURED =
	'Google Calendar is not configured on the server (GOOGLE_SERVICE_ACCOUNT_JSON).';
const NO_CALENDARS =
	'No calendars are set. Enter a lesson calendar or busy calendars and save first.';
const GENERIC_ERROR = 'Could not reach the calendar.';

/** Error text safe to show the admin: never anything that looks like key material. */
function safeMessage(e: unknown): string {
	if (!(e instanceof Error) || !e.message) return GENERIC_ERROR;
	if (/private[ _]key/i.test(e.message)) return GENERIC_ERROR;
	return e.message;
}

/**
 * Reads free/busy for the next 24 hours from each saved calendar (lesson calendar first), one
 * at a time so every calendar gets its own OK or error line.
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
				return { ok: true, line: `${id}: OK` };
			} catch (e) {
				return { ok: false, line: `${id}: ${safeMessage(e)}` };
			}
		})
	);
	return { ok: results.every((r) => r.ok), lines: results.map((r) => r.line) };
}
