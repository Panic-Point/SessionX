import { fail, redirect } from '@sveltejs/kit';
import { completeLogin } from '#lib/server/auth/login-service.ts';
import { startSession } from '#lib/server/auth/start-session.ts';
import { formString } from '#lib/server/admin-actions.ts';
import { getStore } from '#lib/server/context.ts';
import type { Actions, PageServerLoad } from './$types';

// GET only renders a button, so link scanners that prefetch the URL can't use up the token.
export const load: PageServerLoad = ({ url }) => {
	return { token: url.searchParams.get('token') ?? '' };
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const token = formString(await request.formData(), 'token');
		const now = new Date();
		const account = token ? await completeLogin(getStore(), token, now) : null;
		if (!account) return fail(400, { invalid: true as const });
		redirect(303, await startSession(cookies, account, now));
	}
};
