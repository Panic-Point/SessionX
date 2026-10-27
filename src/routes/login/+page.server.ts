import { fail, redirect } from '@sveltejs/kit';
import { requestLoginLink } from '#lib/server/auth/login-service.ts';
import { loginWithPassword } from '#lib/server/auth/password-service.ts';
import { startSession } from '#lib/server/auth/start-session.ts';
import { runInBackground } from '#lib/server/background.ts';
import { formString } from '#lib/server/admin-actions.ts';
import { getAppUrl, getMailer, getStore } from '#lib/server/context.ts';
import {
	passesTurnstile,
	TURNSTILE_FAILED,
	turnstileSiteKey
} from '#lib/server/turnstile-action.ts';
import type { Actions, PageServerLoad } from './$types';

const INCORRECT = 'Email or password is incorrect.';

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.account) redirect(303, locals.account.role === 'admin' ? '/admin' : '/account');
	return {
		// `/login?link` opens the emailed-link form; it works without JavaScript.
		linkMode: url.searchParams.has('link'),
		turnstileSiteKey: turnstileSiteKey()
	};
};

export const actions: Actions = {
	password: async ({ request, cookies, getClientAddress }) => {
		const data = await request.formData();
		const email = formString(data, 'email').trim();
		const password = formString(data, 'password');
		const errors: Partial<Record<'email' | 'password', string>> = {};
		if (!email) errors.email = 'Enter your email address.';
		if (!password) errors.password = 'Enter your password.';
		if (errors.email || errors.password) {
			return fail(400, { mode: 'password' as const, email, errors, error: null, locked: false });
		}
		if (!(await passesTurnstile(data, getClientAddress))) {
			return fail(400, {
				mode: 'password' as const,
				email,
				errors,
				error: TURNSTILE_FAILED,
				locked: false
			});
		}

		const now = new Date();
		const result = await loginWithPassword(getStore(), email, password, now);
		if (!result.ok) {
			return fail(400, {
				mode: 'password' as const,
				email,
				errors,
				error: INCORRECT,
				locked: result.locked
			});
		}
		redirect(303, await startSession(cookies, result.account, now));
	},

	link: async ({ request }) => {
		const email = formString(await request.formData(), 'email').trim();
		if (!email) {
			return fail(400, {
				mode: 'link' as const,
				email,
				errors: { email: 'Enter your email address.' }
			});
		}

		// Not awaited: the response must take the same time whether or not the email has an account.
		runInBackground(
			requestLoginLink(
				{ store: getStore(), mailer: getMailer(), appUrl: getAppUrl() },
				email,
				new Date()
			)
		);

		return { mode: 'link' as const, sent: true as const };
	}
};
