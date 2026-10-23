import { fail, redirect } from '@sveltejs/kit';
import { completeLogin } from '#lib/server/auth/login-service.ts';
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, signSession } from '#lib/server/auth/session.ts';
import { formString } from '#lib/server/admin-actions.ts';
import { getSessionSecret, getStore } from '#lib/server/context.ts';
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

		const exp = Math.floor(now.getTime() / 1000) + SESSION_MAX_AGE_SECONDS;
		const session = await signSession({ accountId: account.id, exp }, getSessionSecret());
		cookies.set(SESSION_COOKIE, session, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: SESSION_MAX_AGE_SECONDS
		});
		redirect(303, account.role === 'admin' ? '/admin' : '/');
	}
};
