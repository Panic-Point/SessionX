import { fail } from '@sveltejs/kit';
import { requestPasswordReset } from '#lib/server/auth/password-service.ts';
import { runInBackground } from '#lib/server/background.ts';
import { formString } from '#lib/server/admin-actions.ts';
import { getAppUrl, getMailer, getStore } from '#lib/server/context.ts';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async ({ request }) => {
		const email = formString(await request.formData(), 'email').trim();
		if (!email) return fail(400, { email, error: 'Enter your email address.' });

		// Not awaited: the response must take the same time whether or not the email has an account.
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
