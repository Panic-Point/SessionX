import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE } from '#lib/server/auth/session.ts';
import type { Actions, PageServerLoad } from './$types';

// Sign-out is POST only; a stray GET just goes home.
export const load: PageServerLoad = () => {
	redirect(303, '/');
};

export const actions: Actions = {
	default: ({ cookies }) => {
		cookies.delete(SESSION_COOKIE, { path: '/' });
		redirect(303, '/');
	}
};
