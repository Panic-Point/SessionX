import { fail } from '@sveltejs/kit';
import { requestPasswordReset } from '#lib/server/auth/password-service.ts';
import { runInBackground } from '#lib/server/background.ts';
import { formString } from '#lib/server/admin-actions.ts';
import { getAppUrl, getMailer, getStore } from '#lib/server/context.ts';
import {
	passesTurnstile,
	TURNSTILE_FAILED,
	turnstileSiteKey
} from '#lib/server/turnstile-action.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({ turnstileSiteKey: turnstileSiteKey() });

export const actions: Actions = {
	default: async ({ request, getClientAddress }) => {
		const data = await request.formData();
		const email = formString(data, 'email').trim();
		if (!email) return fail(400, { email, error: 'Enter your email address.' });
		if (!(await passesTurnstile(data, getClientAddress))) {
			return fail(400, { email, error: TURNSTILE_FAILED });
		}

		// Not awaited: the response must take the same time whether or not the email has an account,
		// and whether or not an email is sent.
		runInBackground(
			requestPasswordReset(
				{ store: getStore(), mailer: getMailer(), appUrl: getAppUrl() },
				email,
				new Date()
			)
		);
		return { sent: true as const };
	}
};
