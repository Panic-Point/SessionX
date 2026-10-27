import { describe, expect, it } from 'vitest';
import { isCacheableResponse, swStrategy } from './sw-routing.ts';

const origin = 'https://sessionx.example';
const precached = new Set(['/_app/immutable/entry/start.abc123.js', '/offline', '/robots.txt']);

function get(path: string, extra: { mode?: string; destination?: string } = {}) {
	return { method: 'GET', url: `${origin}${path}`, ...extra };
}

describe('swStrategy: network-only rules', () => {
	it('never handles non-GET requests, even to precached paths', () => {
		expect(swStrategy({ method: 'POST', url: `${origin}/offline` }, precached, origin)).toBe(
			'network-only'
		);
		expect(
			swStrategy({ method: 'POST', url: `${origin}/book`, mode: 'navigate' }, precached, origin)
		).toBe('network-only');
	});

	it('leaves other origins alone', () => {
		expect(
			swStrategy(
				{ method: 'GET', url: 'https://challenges.cloudflare.com/turnstile/v0/api.js' },
				precached,
				origin
			)
		).toBe('network-only');
	});

	it.each([
		['/book/__data.json'],
		['/__data.json'],
		['/book/__data.json?x-sveltekit-invalidated=01'],
		['/api/cron'],
		['/admin'],
		['/admin/lessons'],
		['/account'],
		['/account/cancel/123'],
		['/login'],
		['/login/verify'],
		['/login/reset'],
		['/login/reset/complete'],
		['/logout'],
		['/manage/abc'],
		['/register'],
		['/register/verify']
	])('%s is network-only, even as a navigation', (path) => {
		expect(swStrategy(get(path), precached, origin)).toBe('network-only');
		expect(swStrategy(get(path, { mode: 'navigate' }), precached, origin)).toBe('network-only');
	});

	it('is not fooled by percent-encoding or case', () => {
		expect(swStrategy(get('/%61dmin/lessons', { mode: 'navigate' }), precached, origin)).toBe(
			'network-only'
		);
		expect(swStrategy(get('/ACCOUNT', { mode: 'navigate' }), precached, origin)).toBe(
			'network-only'
		);
		expect(swStrategy(get('/book/__data%2Ejson'), precached, origin)).toBe('network-only');
	});

	it('fails closed on a malformed percent-encoding', () => {
		expect(swStrategy(get('/book%E0%A4%A', { mode: 'navigate' }), precached, origin)).toBe(
			'network-only'
		);
	});

	it('fails closed on an unparseable URL', () => {
		expect(
			swStrategy({ method: 'GET', url: 'not a url', mode: 'navigate' }, precached, origin)
		).toBe('network-only');
	});
});

describe('swStrategy: cached and navigation routes', () => {
	it('serves precached build assets from the cache', () => {
		expect(swStrategy(get('/_app/immutable/entry/start.abc123.js'), precached, origin)).toBe(
			'precache'
		);
		expect(swStrategy(get('/robots.txt'), precached, origin)).toBe('precache');
	});

	it('serves the offline page from the cache', () => {
		expect(swStrategy(get('/offline', { mode: 'navigate' }), precached, origin)).toBe('precache');
	});

	it('treats a navigation to a public page as network-first', () => {
		expect(
			swStrategy(get('/book', { mode: 'navigate', destination: 'document' }), precached, origin)
		).toBe('network-first-navigation');
		expect(swStrategy(get('/', { mode: 'navigate' }), precached, origin)).toBe(
			'network-first-navigation'
		);
	});

	it('does not mistake a lookalike path for a private one', () => {
		expect(swStrategy(get('/administrators-guide', { mode: 'navigate' }), precached, origin)).toBe(
			'network-first-navigation'
		);
	});

	it('leaves unknown GET assets to the network', () => {
		expect(swStrategy(get('/_app/immutable/chunks/unknown.js'), precached, origin)).toBe(
			'network-only'
		);
		expect(swStrategy(get('/book', { mode: 'cors' }), precached, origin)).toBe('network-only');
	});
});

describe('isCacheableResponse', () => {
	function res(status: number, headers: Record<string, string> = {}) {
		return { status, headers: new Headers(headers) };
	}

	it('accepts a plain 200 response', () => {
		expect(isCacheableResponse(res(200, { 'content-type': 'text/html' }))).toBe(true);
	});

	it.each([[0], [204], [301], [404], [500]])('rejects status %i', (status) => {
		expect(isCacheableResponse(res(status))).toBe(false);
	});

	it('rejects a response that sets a cookie', () => {
		expect(isCacheableResponse(res(200, { 'set-cookie': 'session=abc; HttpOnly' }))).toBe(false);
	});

	it('rejects a response marked no-store or private', () => {
		expect(isCacheableResponse(res(200, { 'cache-control': 'no-store' }))).toBe(false);
		expect(isCacheableResponse(res(200, { 'cache-control': 'private, max-age=0' }))).toBe(false);
	});
});
