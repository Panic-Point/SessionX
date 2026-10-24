import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { adminGuard, isAdminPath } from '#lib/server/admin-guard.ts';
import { SESSION_COOKIE, verifySession } from '#lib/server/auth/session.ts';
import { getSessionSecret, getStore } from '#lib/server/context.ts';

/** Resolves the session cookie to `locals.account`; drops cookies that no longer verify. */
export const handle: Handle = async ({ event, resolve }) => {
	event.locals.account = null;
	const cookie = event.cookies.get(SESSION_COOKIE);
	if (cookie) {
		const session = await verifySession(cookie, getSessionSecret(), new Date());
		const account = session ? await getStore().findAccountById(session.accountId) : null;
		if (account) event.locals.account = account;
		else event.cookies.delete(SESSION_COOKIE, { path: '/' });
	}
	// Central guard: covers page loads, form actions and __data.json, so no admin data leaves unchecked.
	if (isAdminPath(event.url.pathname)) {
		const guard = adminGuard(event.locals.account);
		if (guard.kind === 'redirect') redirect(303, guard.location);
		if (guard.kind === 'forbidden') {
			return new Response('Only the studio admin can view this page.', {
				status: 403,
				headers: { 'content-type': 'text/plain; charset=utf-8' }
			});
		}
	}
	return resolve(event);
};
