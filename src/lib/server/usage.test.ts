import { describe, expect, it, vi } from 'vitest';
import type { Account, UsageStore } from './store/types';
import { beaconEvent, errorEvent, parseBeacon, recordUsage, signInEvent } from './usage';

const NOW = new Date('2026-11-01T17:00:00Z');
const family: Account = { id: 'fam-1', name: 'Pat', email: 'p@example.com', role: 'client' };
const admin: Account = { id: 'adm-1', name: 'Brenda', email: 'b@example.com', role: 'admin' };
const beacon = { visitId: 'visit-12345678', route: '/book', durationMs: 1500, newView: true };

describe('parseBeacon', () => {
	it('accepts a well-formed beacon and caps the duration', () => {
		expect(parseBeacon(beacon)).toEqual(beacon);
		expect(parseBeacon({ ...beacon, durationMs: 99_999_999 })?.durationMs).toBe(30 * 60 * 1000);
		expect(parseBeacon({ ...beacon, route: '/manage/[token]/cancel' })).not.toBeNull();
		expect(parseBeacon({ ...beacon, route: '/account/(tabs)/family' })).not.toBeNull();
	});

	it.each([
		null,
		'text',
		{ ...beacon, visitId: 'short' },
		{ ...beacon, route: 'https://evil.example/' },
		{ ...beacon, route: '/manage/abc?token=1' },
		{ ...beacon, route: `/${'x'.repeat(200)}` },
		{ ...beacon, durationMs: -1 },
		{ ...beacon, durationMs: Number.NaN },
		{ ...beacon, newView: 'yes' }
	])('rejects %j', (body) => {
		expect(parseBeacon(body)).toBeNull();
	});
});

describe('beaconEvent', () => {
	it('records a family or guest page view against the signed-in account', () => {
		expect(beaconEvent(beacon, family, NOW)).toEqual({
			kind: 'page_view',
			occurredAt: NOW,
			accountId: 'fam-1',
			visitId: 'visit-12345678',
			route: '/book',
			durationMs: 1500,
			detail: null
		});
		expect(beaconEvent({ ...beacon, newView: false }, null, NOW)).toMatchObject({
			kind: 'page_time',
			accountId: null
		});
	});

	it('skips the admin and admin pages', () => {
		expect(beaconEvent(beacon, admin, NOW)).toBeNull();
		expect(beaconEvent({ ...beacon, route: '/admin/usage' }, family, NOW)).toBeNull();
	});
});

describe('recordUsage', () => {
	it('logs a failed write instead of throwing', async () => {
		const store = {
			recordUsageEvent: vi.fn().mockRejectedValue(new Error('db down'))
		} as unknown as UsageStore;
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await recordUsage(store, signInEvent(family, NOW)!)).toBe(false);
		expect(errors).toHaveBeenCalledWith('usage: failed to record sign_in event', expect.any(Error));
		errors.mockRestore();
	});
});

describe('signInEvent and errorEvent', () => {
	it('does not count the admin signing in', () => {
		expect(signInEvent(admin, NOW)).toBeNull();
		expect(signInEvent(family, NOW)).toMatchObject({ kind: 'sign_in', accountId: 'fam-1' });
	});

	it('keeps errors short and only ties them to families', () => {
		const e = errorEvent('/book/details', 500, 'x'.repeat(500), admin, NOW);
		expect(e).toMatchObject({ kind: 'error', route: '/book/details', accountId: null });
		expect(e.detail).toHaveLength(200);
		expect(errorEvent(null, 500, 'boom', family, NOW).accountId).toBe('fam-1');
	});
});
