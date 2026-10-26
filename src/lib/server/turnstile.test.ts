import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyTurnstile } from './turnstile.ts';

const URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.restoreAllMocks());

describe('verifyTurnstile', () => {
	it('is disabled when the secret is unset', async () => {
		const fetchFn = vi.fn();
		expect(await verifyTurnstile(null, null, undefined, fetchFn)).toEqual({ ok: true });
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('reports a missing token without calling siteverify', async () => {
		const fetchFn = vi.fn();
		expect(await verifyTurnstile('', '1.2.3.4', 'sekret', fetchFn)).toEqual({
			ok: false,
			reason: 'missing'
		});
		expect(await verifyTurnstile(null, '1.2.3.4', 'sekret', fetchFn)).toEqual({
			ok: false,
			reason: 'missing'
		});
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('accepts a successful verification and posts the expected request', async () => {
		const fetchFn = vi.fn(async () => json({ success: true }));
		const result = await verifyTurnstile('tok', '1.2.3.4', 'sekret', fetchFn as typeof fetch);
		expect(result).toEqual({ ok: true });
		const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe(URL);
		expect(init.method).toBe('POST');
		const body = new URLSearchParams(String(init.body));
		expect(body.get('secret')).toBe('sekret');
		expect(body.get('response')).toBe('tok');
		expect(body.get('remoteip')).toBe('1.2.3.4');
		expect(init.signal).toBeInstanceOf(AbortSignal);
	});

	it('omits remoteip when unknown', async () => {
		const fetchFn = vi.fn(async () => json({ success: true }));
		await verifyTurnstile('tok', null, 'sekret', fetchFn as typeof fetch);
		const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
		expect(new URLSearchParams(String(init.body)).has('remoteip')).toBe(false);
	});

	it('uses a 5 second timeout', async () => {
		const spy = vi.spyOn(AbortSignal, 'timeout');
		await verifyTurnstile('tok', null, 'sekret', (async () =>
			json({ success: true })) as typeof fetch);
		expect(spy).toHaveBeenCalledWith(5000);
	});

	it('rejects when siteverify says success:false', async () => {
		const fetchFn = vi.fn(async () =>
			json({ success: false, 'error-codes': ['invalid-input-response'] })
		);
		expect(await verifyTurnstile('tok', null, 'sekret', fetchFn as typeof fetch)).toEqual({
			ok: false,
			reason: 'rejected'
		});
	});

	it('fails open on a network error and never logs the secret', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		const fetchFn = vi.fn(async () => {
			throw new Error('boom');
		});
		expect(await verifyTurnstile('tok', null, 'sekret', fetchFn as typeof fetch)).toEqual({
			ok: true
		});
		expect(err).toHaveBeenCalled();
		expect(JSON.stringify(err.mock.calls)).not.toContain('sekret');
	});

	it('fails open on a non-2xx response', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		const fetchFn = vi.fn(async () => json({}, 500));
		expect(await verifyTurnstile('tok', null, 'sekret', fetchFn as typeof fetch)).toEqual({
			ok: true
		});
		expect(err).toHaveBeenCalled();
		expect(JSON.stringify(err.mock.calls)).not.toContain('sekret');
	});

	it('fails open on a timeout', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const fetchFn = vi.fn(async () => {
			throw new DOMException('timed out', 'TimeoutError');
		});
		expect(await verifyTurnstile('tok', null, 'sekret', fetchFn as typeof fetch)).toEqual({
			ok: true
		});
	});
});
