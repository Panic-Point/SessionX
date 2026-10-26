import { isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { requireAccount } from './account-guard';
import type { Account } from './store/types';

const client: Account = { id: 'a1', name: 'Pat', email: 'pat@example.com', role: 'client' };
const admin: Account = { id: 'a2', name: 'Teacher', email: 'admin@example.com', role: 'admin' };

function thrown(fn: () => unknown): unknown {
	try {
		fn();
	} catch (e) {
		return e;
	}
	return undefined;
}

describe('requireAccount', () => {
	it('redirects a signed-out visitor to /login with 303', () => {
		const result = thrown(() => requireAccount(null));
		expect(isRedirect(result)).toBe(true);
		expect(result).toMatchObject({ status: 303, location: '/login' });
	});
	it('returns the signed-in client account', () => {
		expect(requireAccount(client)).toBe(client);
	});
	it('returns an admin account too (admins book as an account)', () => {
		expect(requireAccount(admin)).toBe(admin);
	});
});
