import { redirect } from '@sveltejs/kit';
import type { Account } from './store/types';

/**
 * Signed-out visitors get a 303 to /login. Every `/account/**` load and action calls this first:
 * a `__data.json` request can skip layout loads, so no page may rely on a parent to guard it.
 * Admins are accounts too, so they pass.
 */
export function requireAccount(account: Account | null): Account {
	if (!account) redirect(303, '/login');
	return account;
}
