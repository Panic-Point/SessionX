import * as env from '$app/env/private';
import { dev } from '$app/env';
import { getRequestEvent } from '$app/server';
import { configureCalendar, type ConfiguredCalendar } from './calendar/configure';
import type { CalendarClient } from './calendar/types';
import { chooseStore, getSessionSecret as pickSessionSecret } from './choose-store';
import { createMailer, type Mailer } from './email/mailer';
import { demoData } from './store/demo-data';
import { MemoryBookingStore } from './store/memory';
import { createSupabaseBookingStore } from './store/supabase';
import type { AppStore } from './store/types';

let memoryStore: MemoryBookingStore | undefined;
let calendar: ConfiguredCalendar | undefined;

/** In-memory demo store only for `BOOKING_STORE=memory` or dev without Supabase; see `chooseStore`. */
export function getStore(): AppStore {
	const choice = chooseStore(env, dev);
	if (choice.kind === 'memory') {
		memoryStore ??= new MemoryBookingStore(demoData());
		return memoryStore;
	}
	return createSupabaseBookingStore(choice.url, choice.key);
}

export function getMailer(): Mailer {
	return createMailer(
		{
			EMAIL_TRANSPORT: env.EMAIL_TRANSPORT,
			RESEND_API_KEY: env.RESEND_API_KEY,
			MAILPIT_URL: env.MAILPIT_URL,
			EMAIL_FROM: env.EMAIL_FROM
		},
		fetch,
		{ dev }
	);
}

function configuredCalendar(): ConfiguredCalendar {
	calendar ??= configureCalendar({ GOOGLE_SERVICE_ACCOUNT_JSON: env.GOOGLE_SERVICE_ACCOUNT_JSON });
	return calendar;
}

/**
 * Google Calendar client, created once per module. Disabled when GOOGLE_SERVICE_ACCOUNT_JSON is
 * unset or invalid (logged once), so calendar config can never break booking.
 */
export function getCalendar(): CalendarClient {
	return configuredCalendar().client;
}

/** What the settings page may show about the calendar setup: never the key or the raw env value. */
export function getCalendarStatus(): {
	enabled: boolean;
	serviceAccountEmail: string | null;
	configError: string | null;
} {
	const { client, configError } = configuredCalendar();
	return { enabled: client.enabled, serviceAccountEmail: client.serviceAccountEmail, configError };
}

/** `PUBLIC_APP_URL` (without a trailing slash), or the current request's origin. */
export function getAppUrl(): string {
	return (env.PUBLIC_APP_URL ?? getRequestEvent().url.origin).replace(/\/+$/, '');
}

/** Session cookie signing secret; see `getSessionSecret` in choose-store. */
export function getSessionSecret(): string {
	return pickSessionSecret(env, dev);
}
