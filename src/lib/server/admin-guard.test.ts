import { describe, expect, it } from 'vitest';
import { adminGuard } from './admin-guard';
import type { Account } from './store/types';

const base: Omit<Account, 'role'> = { id: 'a1', name: 'Pat', email: 'pat@example.com' };

describe('adminGuard', () => {
	it('redirects to /login when nobody is signed in', () => {
		expect(adminGuard(null)).toEqual({ kind: 'redirect', location: '/login' });
	});
	it('forbids a signed-in client', () => {
		expect(adminGuard({ ...base, role: 'client' })).toEqual({ kind: 'forbidden' });
	});
	it('allows an admin', () => {
		expect(adminGuard({ ...base, role: 'admin' })).toEqual({ kind: 'ok' });
	});
});
