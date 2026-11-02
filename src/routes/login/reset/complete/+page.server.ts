import { fail, redirect } from '@sveltejs/kit';
import { completePasswordReset } from '#lib/server/auth/password-service.ts';
import { signIn } from '#lib/server/auth/start-session.ts';
import { formString } from '#lib/server/admin-actions.ts';
import { getStore } from '#lib/server/context.ts';
import type { Actions, PageServerLoad } from './$types';

// GET only renders the form, so link scanners that prefetch the URL can't use up the token.
export const load: PageServerLoad = ({ url }) => {
	return { token: url.searchParams.get('token') ?? '' };
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		const now = new Date();
		const result = await completePasswordReset(
			getStore(),
			formString(data, 'token'),
			formString(data, 'password'),
			formString(data, 'confirmPassword'),
			now
		);
		if (!result.ok) {
			return result.invalid
				? fail(400, { invalid: true as const, errors: {} })
				: fail(400, { invalid: false as const, errors: result.errors });
		}
		redirect(303, await signIn(cookies, result.account, now));
	}
};
