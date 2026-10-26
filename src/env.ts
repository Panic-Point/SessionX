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
			'`memory` forces the in-memory demo store. Otherwise memory is used only in dev when SUPABASE_URL is unset.'
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
	},
	SESSION_SECRET: {
		schema: optional,
		description:
			'Secret for signing admin session cookies. Required in production; dev falls back to a fixed dev-only value.'
	},
	GOOGLE_SERVICE_ACCOUNT_JSON: {
		schema: optional,
		description:
			'Google service-account key JSON (server only). Unset disables Google Calendar sync. See docs/google-calendar.md.'
	}
});
