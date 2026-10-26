/**
 * Pure routing rules for the service worker. There are no DOM or worker globals here, so
 * Vitest can test the same code the worker runs.
 *
 * Privacy first: anything personal, admin, auth or data-carrying always goes to the network
 * and is never cached.
 */

export type SwStrategy = 'precache' | 'network-first-navigation' | 'network-only';

/** Path prefixes whose pages or endpoints can carry personal or admin data. */
const PRIVATE_SECTIONS = ['/api', '/admin', '/account', '/login', '/logout', '/manage'];

function isPrivatePath(pathname: string): boolean {
	// Match on the decoded, lower-cased path so `/%61dmin` or `/ADMIN` can't slip past.
	const path = pathname.toLowerCase();
	if (path === '/__data.json' || path.endsWith('/__data.json')) return true;
	return PRIVATE_SECTIONS.some((section) => path === section || path.startsWith(`${section}/`));
}

export function swStrategy(
	req: { method: string; url: string; mode?: string; destination?: string },
	precached: Set<string>,
	origin: string
): SwStrategy {
	if (req.method !== 'GET') return 'network-only';

	let url: URL;
	let decoded: string;
	try {
		url = new URL(req.url);
		decoded = decodeURIComponent(url.pathname);
	} catch {
		return 'network-only'; // fail closed
	}

	if (url.origin !== origin) return 'network-only';
	if (isPrivatePath(decoded)) return 'network-only';
	if (precached.has(url.pathname)) return 'precache';
	if (req.mode === 'navigate') return 'network-first-navigation';
	return 'network-only';
}

/**
 * Whether a response may be written to the cache: a 200 that doesn't set a cookie and
 * isn't marked `no-store` or `private`.
 *
 * Browsers hide `Set-Cookie` from service-worker JS, so that check is a backstop here.
 * The real protection is that only build assets, static files and `/offline` are ever
 * written to the cache.
 */
export function isCacheableResponse(res: {
	status: number;
	headers: { get(name: string): string | null; has(name: string): boolean };
}): boolean {
	if (res.status !== 200) return false;
	if (res.headers.has('set-cookie')) return false;
	const cacheControl = (res.headers.get('cache-control') ?? '').toLowerCase();
	return !/\b(no-store|private)\b/.test(cacheControl);
}
