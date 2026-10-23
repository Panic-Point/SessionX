import type { Account } from './store/types';

export type AdminGuardResult =
	{ kind: 'ok' } | { kind: 'redirect'; location: '/login' } | { kind: 'forbidden' };

/** Signed-out visitors go to /login; signed-in non-admins are forbidden. */
export function adminGuard(account: Account | null): AdminGuardResult {
	if (!account) return { kind: 'redirect', location: '/login' };
	if (account.role !== 'admin') return { kind: 'forbidden' };
	return { kind: 'ok' };
}
