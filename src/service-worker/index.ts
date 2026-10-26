/// <reference types="@sveltejs/kit" />
// Makes SessionX installable and shows /offline when there's no connection. It only ever
// caches build output, static files and /offline. Personal, admin and data requests are
// never cached; the rules live in #lib/sw-routing.ts.
import { version } from '$app/env';
import { assets, immutable, prerendered } from '$app/manifest';
import { self } from '$app/service-worker';
import { isCacheableResponse, swStrategy } from '#lib/sw-routing.ts';

const CACHE = `sessionx-${version}`;
// Manifest paths are relative to the base path, which is where this worker is served from.
const toPath = (path: string) => new URL(path, self.location.href).pathname;
const OFFLINE = toPath('offline');

// `prerendered` contains /offline once built. It is added explicitly too, because the
// manifest lists are empty in dev. Anything the routing rules treat as network-only
// (e.g. `offline/__data.json`, or a private page someone prerenders later) is left out.
const PRECACHE = [
	...new Set([...immutable, ...assets, ...prerendered].map(({ path }) => toPath(path))).add(OFFLINE)
].filter(
	(path) =>
		swStrategy(
			{ method: 'GET', url: new URL(path, self.location.origin).href },
			new Set([path]),
			self.location.origin
		) === 'precache'
);
const precached = new Set(PRECACHE);

async function precache(): Promise<void> {
	const cache = await caches.open(CACHE);
	await Promise.all(
		PRECACHE.map(async (path) => {
			const response = await fetch(path, { cache: 'reload', credentials: 'omit' });
			if (!isCacheableResponse(response)) {
				throw new Error(`Refusing to precache ${path} (status ${response.status})`);
			}
			await cache.put(path, response);
		})
	);
}

async function fromPrecache(request: Request): Promise<Response> {
	const cache = await caches.open(CACHE);
	const url = new URL(request.url);
	return (await cache.match(url.pathname)) ?? fetch(request);
}

/** Navigations always go to the network and are never cached; offline, show /offline. */
async function networkFirstNavigation(request: Request): Promise<Response> {
	try {
		return await fetch(request);
	} catch (error) {
		const cache = await caches.open(CACHE);
		const offline = await cache.match(OFFLINE);
		if (offline) return offline;
		throw error;
	}
}

self.addEventListener('install', (event) => {
	event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE) await caches.delete(key);
			}
			await self.clients.claim();
		})()
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	const strategy = swStrategy(request, precached, self.location.origin);
	// network-only: don't call respondWith, so the browser handles it as if there were no worker.
	if (strategy === 'precache') event.respondWith(fromPrecache(request));
	else if (strategy === 'network-first-navigation') {
		event.respondWith(networkFirstNavigation(request));
	}
});
