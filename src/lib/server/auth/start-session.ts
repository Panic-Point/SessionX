import type { Cookies } from '@sveltejs/kit';
import { dev } from '$app/env';
import { getSessionSecret } from '../context';
import type { Account } from '../store/types';
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, signSession } from './session';

/** Sets the `sx_session` cookie and returns where the account lands after signing in. */
export async function startSession(cookies: Cookies, account: Account, now: Date): Promise<string> {
	const exp = Math.floor(now.getTime() / 1000) + SESSION_MAX_AGE_SECONDS;
	const session = await signSession({ accountId: account.id, exp }, getSessionSecret());
	cookies.set(SESSION_COOKIE, session, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: !dev,
		maxAge: SESSION_MAX_AGE_SECONDS
	});
	return account.role === 'admin' ? '/admin' : '/account';
}
