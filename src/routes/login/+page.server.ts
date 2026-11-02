import { fail, redirect } from '@sveltejs/kit';
import { loginWithPassword } from '#lib/server/auth/password-service.ts';
import { signIn } from '#lib/server/auth/start-session.ts';
import { formString } from '#lib/server/admin-actions.ts';
import { getStore } from '#lib/server/context.ts';
import { recordUsage, signInFailedEvent } from '#lib/server/usage.ts';
import {
	passesTurnstile,
	TURNSTILE_FAILED,
	turnstileSiteKey
} from '#lib/server/turnstile-action.ts';
import type { Actions, PageServerLoad } from './$types';

const INCORRECT = 'Email or password is incorrect.';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.account) redirect(303, locals.account.role === 'admin' ? '/admin' : '/account');
	return { turnstileSiteKey: turnstileSiteKey() };
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		const data = await request.formData();
		const email = formString(data, 'email').trim();
		const password = formString(data, 'password');
		const errors: Partial<Record<'email' | 'password', string>> = {};
		if (!email) errors.email = 'Enter your email address.';
		if (!password) errors.password = 'Enter your password.';
		if (errors.email || errors.password) {
			return fail(400, { email, errors, error: null, locked: false });
		}
		if (!(await passesTurnstile(data, getClientAddress))) {
			return fail(400, {
				email,
				errors,
				error: TURNSTILE_FAILED,
				locked: false
			});
		}

		const now = new Date();
		const result = await loginWithPassword(getStore(), email, password, now);
		if (!result.ok) {
			await recordUsage(getStore(), signInFailedEvent(now));
			return fail(400, {
				email,
				errors,
				error: INCORRECT,
				locked: result.locked
			});
		}
		redirect(303, await signIn(cookies, result.account, now));
	}
};
