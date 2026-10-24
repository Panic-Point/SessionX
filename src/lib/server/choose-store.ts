export type StoreChoice = { kind: 'memory' } | { kind: 'supabase'; url: string; key: string };

/**
 * Pick the booking store from plain env values. The in-memory store is only for
 * `BOOKING_STORE=memory` or local dev without Supabase; production must be configured.
 */
export function chooseStore(
	env: { BOOKING_STORE?: string; SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string },
	dev: boolean
): StoreChoice {
	if (env.BOOKING_STORE === 'memory') return { kind: 'memory' };
	if (!env.SUPABASE_URL) {
		if (dev) return { kind: 'memory' };
		throw new Error(
			'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (or BOOKING_STORE=memory)'
		);
	}
	if (!env.SUPABASE_SERVICE_ROLE_KEY) {
		throw new Error(
			'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (or BOOKING_STORE=memory): SUPABASE_SERVICE_ROLE_KEY is missing'
		);
	}
	return { kind: 'supabase', url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY };
}

export const DEV_SESSION_SECRET = 'dev-only-session-secret-change-me';

/** Session signing secret. An empty value counts as unset; only dev gets a fallback. */
export function getSessionSecret(env: { SESSION_SECRET?: string }, dev: boolean): string {
	if (env.SESSION_SECRET) return env.SESSION_SECRET;
	if (dev) return DEV_SESSION_SECRET;
	throw new Error('SESSION_SECRET must be set');
}
