import type { Cookies } from '@sveltejs/kit';
import { dev } from '$app/env';
import { getSessionSecret, getStore } from '../context';
import type { Account } from '../store/types';
import { recordUsage, signInEvent } from '../usage';
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, signSession } from './session';

/**
 * Sets the `sx_session` cookie and returns where the account lands after signing in. Reads the
 * session version after any password change, so the new cookie outlives the revocation.
 */
export async function startSession(cookies: Cookies, account: Account, now: Date): Promise<string> {
	const exp = Math.floor(now.getTime() / 1000) + SESSION_MAX_AGE_SECONDS;
	const found = await getStore().findSessionAccount(account.id);
	if (!found) throw new Error('startSession: account not found');
	const session = await signSession(
		{ accountId: account.id, sessionVersion: found.sessionVersion, exp },
		getSessionSecret()
	);
	cookies.set(SESSION_COOKIE, session, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: !dev,
		maxAge: SESSION_MAX_AGE_SECONDS
	});
	return account.role === 'admin' ? '/admin' : '/account';
}

/**
 * startSession for a real sign-in (password, registration or reset), counted on the Usage tab.
 * Re-issuing the cookie after a password change is not a sign-in, so that uses startSession.
 */
export async function signIn(cookies: Cookies, account: Account, now: Date): Promise<string> {
	const event = signInEvent(account, now);
	if (event) await recordUsage(getStore(), event);
	return startSession(cookies, account, now);
}
