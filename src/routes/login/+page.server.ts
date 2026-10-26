import { fail, redirect } from '@sveltejs/kit';
import { requestLoginLink } from '#lib/server/auth/login-service.ts';
import { runInBackground } from '#lib/server/background.ts';
import { formString } from '#lib/server/admin-actions.ts';
import { getAppUrl, getMailer, getStore } from '#lib/server/context.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.account) redirect(303, locals.account.role === 'admin' ? '/admin' : '/account');
};

export const actions: Actions = {
	default: async ({ request }) => {
		const email = formString(await request.formData(), 'email').trim();
		if (!email) {
			return fail(400, { email, error: 'Enter your email address.' });
		}

		// Not awaited: the response must take the same time whether or not the email has an account.
		runInBackground(
			requestLoginLink(
				{ store: getStore(), mailer: getMailer(), appUrl: getAppUrl() },
				email,
				new Date()
			)
		);

		return { sent: true as const };
	}
};
