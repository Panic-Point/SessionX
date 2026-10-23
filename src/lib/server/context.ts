import * as env from '$app/env/private';
import { getRequestEvent } from '$app/server';
import { createMailer, type Mailer } from './email/mailer';
import { demoData } from './store/demo-data';
import { MemoryBookingStore } from './store/memory';
import { createSupabaseBookingStore } from './store/supabase';
import type { BookingStore } from './store/types';

let memoryStore: MemoryBookingStore | undefined;

/** `BOOKING_STORE=memory`, or no `SUPABASE_URL`, gives the shared in-memory demo store. */
export function getStore(): BookingStore {
	if (env.BOOKING_STORE === 'memory' || !env.SUPABASE_URL) {
		memoryStore ??= new MemoryBookingStore(demoData());
		return memoryStore;
	}
	return createSupabaseBookingStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY ?? '');
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
