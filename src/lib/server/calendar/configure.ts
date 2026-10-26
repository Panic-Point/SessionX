import { createCalendarClient, type GoogleEnv } from './google';
import type { CalendarClient } from './types';

export interface ConfiguredCalendar {
	client: CalendarClient;
	/** Secret-free reason the env var could not be used, or null. */
	configError: string | null;
}

/**
 * The calendar client for this env. An invalid `GOOGLE_SERVICE_ACCOUNT_JSON` never throws: it
 * logs the (secret-free) reason once and falls back to a disabled client so booking keeps working.
 */
export function configureCalendar(
	env: GoogleEnv,
	log: (message: string) => void = console.error
): ConfiguredCalendar {
	try {
		return { client: createCalendarClient(env), configError: null };
	} catch (e) {
		// createCalendarClient's errors are secret-free by contract; anything else gets a fixed text.
		const configError =
			e instanceof Error && e.message.startsWith('GOOGLE_SERVICE_ACCOUNT_JSON')
				? e.message
				: 'GOOGLE_SERVICE_ACCOUNT_JSON could not be used';
		log(`Google Calendar disabled: ${configError}`);
		return { client: createCalendarClient({}), configError };
	}
}
