import { redirect } from '@sveltejs/kit';
import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import { adminGuard, isAdminRequest } from '#lib/server/admin-guard.ts';
import { SESSION_COOKIE, verifySession } from '#lib/server/auth/session.ts';
import { getSessionSecret, getStore } from '#lib/server/context.ts';
import { errorEvent, recordUsage } from '#lib/server/usage.ts';

/**
 * Resolves the session cookie to `locals.account`; drops cookies that no longer verify, including
 * ones issued before the account's sessions were revoked.
 */
export const handle: Handle = async ({ event, resolve }) => {
	event.locals.account = null;
	const cookie = event.cookies.get(SESSION_COOKIE);
	if (cookie) {
		const session = await verifySession(cookie, getSessionSecret(), new Date());
		const found = session ? await getStore().findSessionAccount(session.accountId) : null;
		if (found && found.sessionVersion === session?.sessionVersion) {
			event.locals.account = found.account;
		} else {
			event.cookies.delete(SESSION_COOKIE, { path: '/' });
		}
	}
	// Central guard: covers page loads, form actions and __data.json, so no admin data leaves unchecked.
	// Checks the resolved route as well as the pathname, since `/%61dmin` routes to `/admin`.
	if (isAdminRequest(event.route.id, event.url.pathname)) {
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

/**
 * Unexpected server errors (bugs, a failing database) are logged, as before, and counted on the
 * admin Usage tab by page, so the teacher can see where families hit problems. Errors thrown on
 * purpose with `error()` and SvelteKit's own 404s are not counted.
 */
export const handleError: HandleServerError = async (caught) => {
	console.error(caught.error);
	if (caught.kind !== 'unknown') return;
	const { event } = caught;
	const err = caught.error;
	const message = err instanceof Error ? `${err.name}: ${err.message}` : 'Unknown error';
	try {
		const usage = errorEvent(event.route.id, 500, message, event.locals.account, new Date());
		await recordUsage(getStore(), usage);
	} catch (e) {
		// getStore() throws when the store is not configured; that error is already the one logged.
		console.error('usage: could not record the error', e);
	}
};
