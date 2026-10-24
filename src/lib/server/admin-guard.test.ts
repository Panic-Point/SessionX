import { describe, expect, it } from 'vitest';
import { adminGuard, isAdminPath } from './admin-guard';
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

describe('isAdminPath', () => {
	it.each([
		'/admin',
		'/admin/',
		'/admin/lessons',
		'/admin/__data.json',
		'/admin/lessons/__data.json'
	])('treats %s as an admin path', (path) => {
		expect(isAdminPath(path)).toBe(true);
	});
	it.each(['/', '/administrator', '/adminx', '/login', '/book/admin', '/Admin'])(
		'does not treat %s as an admin path',
		(path) => {
			expect(isAdminPath(path)).toBe(false);
		}
	);
});
