import { describe, expect, it } from 'vitest';
import { chooseStore, getSessionSecret } from './choose-store';

describe('chooseStore', () => {
	it('uses memory when BOOKING_STORE=memory, even in production', () => {
		expect(chooseStore({ BOOKING_STORE: 'memory' }, false)).toEqual({ kind: 'memory' });
	});
	it('uses memory when BOOKING_STORE=memory even if Supabase is configured', () => {
		expect(
			chooseStore(
				{ BOOKING_STORE: 'memory', SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 'k' },
				false
			)
		).toEqual({ kind: 'memory' });
	});
	it('uses memory in dev when SUPABASE_URL is unset', () => {
		expect(chooseStore({}, true)).toEqual({ kind: 'memory' });
	});
	it('throws in production when SUPABASE_URL is unset', () => {
		expect(() => chooseStore({}, false)).toThrow(/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/);
	});
	it('uses supabase when url and key are set', () => {
		expect(chooseStore({ SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 'k' }, false)).toEqual({
			kind: 'supabase',
			url: 'u',
			key: 'k'
		});
	});
	it('throws when the url is set but the key is missing (dev or prod)', () => {
		expect(() => chooseStore({ SUPABASE_URL: 'u' }, true)).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
		expect(() => chooseStore({ SUPABASE_URL: 'u' }, false)).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
	});
});

describe('getSessionSecret', () => {
	it('returns SESSION_SECRET when set (dev or prod)', () => {
		expect(getSessionSecret({ SESSION_SECRET: 's3cret' }, false)).toBe('s3cret');
		expect(getSessionSecret({ SESSION_SECRET: 's3cret' }, true)).toBe('s3cret');
	});
	it('falls back to the dev-only secret in dev when unset or empty', () => {
		expect(getSessionSecret({}, true)).toBe('dev-only-session-secret-change-me');
		expect(getSessionSecret({ SESSION_SECRET: '' }, true)).toBe(
			'dev-only-session-secret-change-me'
		);
	});
	it('throws in production when unset', () => {
		expect(() => getSessionSecret({}, false)).toThrow('SESSION_SECRET must be set');
	});
	it('treats an empty string as unset in production', () => {
		expect(() => getSessionSecret({ SESSION_SECRET: '' }, false)).toThrow(
			'SESSION_SECRET must be set'
		);
	});
});
