import { describe, expect, it } from 'vitest';
import { signSession, verifySession } from './session';

const secret = 's3cret';
const now = new Date('2026-11-01T00:00:00Z');
const payload = {
	accountId: 'acc-1',
	sessionVersion: 2,
	exp: Math.floor(now.getTime() / 1000) + 3600
};

describe('session', () => {
	it('round-trips', async () => {
		const c = await signSession(payload, secret);
		expect(await verifySession(c, secret, now)).toEqual(payload);
	});
	it('rejects tampered payload', async () => {
		const c = await signSession(payload, secret);
		const [, sig] = c.split('.');
		const forged = btoa(JSON.stringify({ accountId: 'admin', sessionVersion: 2, exp: payload.exp }))
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/, '');
		expect(await verifySession(`${forged}.${sig}`, secret, now)).toBeNull();
	});
	it('rejects bad signature', async () => {
		const c = await signSession(payload, secret);
		expect(await verifySession(c, 'other', now)).toBeNull();
	});
	it('rejects expired', async () => {
		const c = await signSession({ ...payload, exp: Math.floor(now.getTime() / 1000) - 1 }, secret);
		expect(await verifySession(c, secret, now)).toBeNull();
	});
	it('rejects a cookie signed without a session version', async () => {
		const c = await signSession(
			{ accountId: 'acc-1', exp: payload.exp } as unknown as typeof payload,
			secret
		);
		expect(await verifySession(c, secret, now)).toBeNull();
	});
	it('rejects malformed/undefined', async () => {
		expect(await verifySession(undefined, secret, now)).toBeNull();
		expect(await verifySession('', secret, now)).toBeNull();
		expect(await verifySession('abc', secret, now)).toBeNull();
		expect(await verifySession('a.b.c', secret, now)).toBeNull();
		expect(await verifySession('!!!.???', secret, now)).toBeNull();
	});
});
