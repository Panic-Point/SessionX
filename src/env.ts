import { defineEnvVars } from '@sveltejs/kit/env';

/** Optional runtime string: an unset or empty value reads as `undefined`. */
const optional = (value: string | undefined) => value || undefined;

/**
 * Server runtime env (read from the platform when the app starts, never inlined).
 * SvelteKit 3 only exposes variables declared here via `$app/env/private`.
 */
export const variables = defineEnvVars({
	BOOKING_STORE: {
		schema: optional,
		description:
			'`memory` forces the in-memory demo store. Defaults to memory when SUPABASE_URL is unset.'
	},
	SUPABASE_URL: { schema: optional, description: 'Supabase API URL.' },
	SUPABASE_SERVICE_ROLE_KEY: {
		schema: optional,
		description: 'Supabase service-role key (server only).'
	},
	PUBLIC_APP_URL: {
		schema: optional,
		description: 'Public origin used in email links. Defaults to the request origin.'
	},
	EMAIL_TRANSPORT: {
		schema: optional,
		description: '`resend`, `mailpit`, or unset to log emails to the console.'
	},
	RESEND_API_KEY: { schema: optional, description: 'Resend API key.' },
	MAILPIT_URL: { schema: optional, description: 'Mailpit base URL, e.g. http://127.0.0.1:54324.' },
	EMAIL_FROM: {
		schema: optional,
		description: 'From address, e.g. `SessionX <bookings@example.com>`.'
	}
});
