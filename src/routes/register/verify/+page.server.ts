import { fail, redirect } from '@sveltejs/kit';
import { checkRegistrationLink, completeRegistration } from '#lib/server/auth/password-service.ts';
import { signIn } from '#lib/server/auth/start-session.ts';
import { formString } from '#lib/server/admin-actions.ts';
import { getStore } from '#lib/server/context.ts';
import type { Actions, PageServerLoad } from './$types';

// GET only looks the link up, so link scanners that prefetch the URL can't use up the token.
export const load: PageServerLoad = async ({ url }) => {
	const token = url.searchParams.get('token') ?? '';
	const link = await checkRegistrationLink(getStore(), token, new Date());
	return link
		? { token, valid: true as const, email: link.email, needsName: link.needsName }
		: { token: '', valid: false as const, email: '', needsName: false };
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		const now = new Date();
		const name = formString(data, 'name');
		const result = await completeRegistration(
			getStore(),
			formString(data, 'token'),
			{
				name,
				password: formString(data, 'password'),
				confirmPassword: formString(data, 'confirmPassword')
			},
			now
		);
		if (!result.ok) {
			// Passwords are never sent back to the page.
			return result.invalid
				? fail(400, { invalid: true as const, values: { name }, errors: {} })
				: fail(400, { invalid: false as const, values: { name }, errors: result.errors });
		}
		redirect(303, await signIn(cookies, result.account, now));
	}
};
