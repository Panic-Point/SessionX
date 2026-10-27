import { fail, redirect } from '@sveltejs/kit';
import { requestRegistration, validateRegistration } from '#lib/server/auth/password-service.ts';
import { runInBackground } from '#lib/server/background.ts';
import { formString } from '#lib/server/admin-actions.ts';
import { getAppUrl, getMailer, getStore } from '#lib/server/context.ts';
import {
	passesTurnstile,
	TURNSTILE_FAILED,
	turnstileSiteKey
} from '#lib/server/turnstile-action.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.account) redirect(303, locals.account.role === 'admin' ? '/admin' : '/account');
	return {
		// The guest invite email links here with the booking's email filled in.
		email: (url.searchParams.get('email') ?? '').slice(0, 254),
		turnstileSiteKey: turnstileSiteKey()
	};
};

export const actions: Actions = {
	default: async ({ request, getClientAddress }) => {
		const data = await request.formData();
		const values = { email: formString(data, 'email') };

		const checked = validateRegistration(values);
		if (!checked.ok) return fail(400, { values, errors: checked.errors });
		if (!(await passesTurnstile(data, getClientAddress))) {
			return fail(400, { values, errors: { form: TURNSTILE_FAILED } });
		}

		// Not awaited, and the same answer for every email: nothing reveals whether an account exists.
		runInBackground(
			requestRegistration(
				{ store: getStore(), mailer: getMailer(), appUrl: getAppUrl() },
				checked.email,
				new Date()
			)
		);
		return { sent: true as const };
	}
};
