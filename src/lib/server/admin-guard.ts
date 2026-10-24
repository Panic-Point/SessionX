import type { Account } from './store/types';

export type AdminGuardResult =
	{ kind: 'ok' } | { kind: 'redirect'; location: '/login' } | { kind: 'forbidden' };

/** Signed-out visitors go to /login; signed-in non-admins are forbidden. */
export function adminGuard(account: Account | null): AdminGuardResult {
	if (!account) return { kind: 'redirect', location: '/login' };
	if (account.role !== 'admin') return { kind: 'forbidden' };
	return { kind: 'ok' };
}

function isAdminPrefix(path: string): boolean {
	return path === '/admin' || path.startsWith('/admin/');
}

/**
 * True for `/admin` and everything beneath it, including `__data.json` data requests. Decodes
 * the pathname first because the router matches the decoded path (`/%61dmin` routes to `/admin`);
 * a malformed encoding is treated as an admin path so it fails closed.
 */
export function isAdminPath(pathname: string): boolean {
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return true;
	}
	return isAdminPrefix(pathname) || isAdminPrefix(decoded);
}

/** True when the resolved route is an admin route, or (fallback) the pathname is an admin path. */
export function isAdminRequest(routeId: string | null, pathname: string): boolean {
	return (routeId !== null && isAdminPrefix(routeId)) || isAdminPath(pathname);
}
