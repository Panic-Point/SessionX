import * as env from '$app/env/private';
import { dev } from '$app/env';
import { getRequestEvent } from '$app/server';
import { chooseStore, getSessionSecret as pickSessionSecret } from './choose-store';
import { createMailer, type Mailer } from './email/mailer';
import { demoData } from './store/demo-data';
import { MemoryBookingStore } from './store/memory';
import { createSupabaseBookingStore } from './store/supabase';
import type { AdminStore, BookingStore } from './store/types';

let memoryStore: MemoryBookingStore | undefined;

/** In-memory demo store only for `BOOKING_STORE=memory` or dev without Supabase; see `chooseStore`. */
export function getStore(): BookingStore & AdminStore {
	const choice = chooseStore(env, dev);
	if (choice.kind === 'memory') {
		memoryStore ??= new MemoryBookingStore(demoData());
		return memoryStore;
	}
	return createSupabaseBookingStore(choice.url, choice.key);
}

export function getMailer(): Mailer {
	return createMailer({
		EMAIL_TRANSPORT: env.EMAIL_TRANSPORT,
		RESEND_API_KEY: env.RESEND_API_KEY,
		MAILPIT_URL: env.MAILPIT_URL,
		EMAIL_FROM: env.EMAIL_FROM
	});
}

/** `PUBLIC_APP_URL` (without a trailing slash), or the current request's origin. */
export function getAppUrl(): string {
	return (env.PUBLIC_APP_URL ?? getRequestEvent().url.origin).replace(/\/+$/, '');
}

/** Session cookie signing secret; see `getSessionSecret` in choose-store. */
export function getSessionSecret(): string {
	return pickSessionSecret(env, dev);
}
