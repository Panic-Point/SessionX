import type { Handle } from '@sveltejs/kit/hooks';
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
	return resolve(event);
};
