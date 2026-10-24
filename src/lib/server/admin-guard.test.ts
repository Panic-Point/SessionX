import { describe, expect, it } from 'vitest';
import { adminGuard, isAdminPath, isAdminRequest } from './admin-guard';
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
		'/admin/lessons/__data.json',
		'/%61dmin',
		'/%61dmin/__data.json',
		'/%61dmin/lessons/__data.json',
		'/ad%6Din',
		'/ad%6din/settings'
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

describe('isAdminRequest', () => {
	it.each([
		['/admin', '/x'],
		['/admin/lessons', '/x'],
		['/admin/settings', '/whatever']
	])('guards route %s whatever the pathname', (routeId, path) => {
		expect(isAdminRequest(routeId, path)).toBe(true);
	});
	it.each(['/%61dmin/__data.json', '/ad%6Din/lessons'])(
		'guards encoded admin pathname %s when no route matched',
		(path) => {
			expect(isAdminRequest(null, path)).toBe(true);
		}
	);
	it('treats a malformed percent-encoding as an admin path', () => {
		expect(isAdminRequest(null, '/%E0%A4%A')).toBe(true);
	});
	it.each([
		['/', '/'],
		['/book', '/book'],
		['/administrator', '/administrator'],
		[null, '/login']
	])('does not guard route %s', (routeId, path) => {
		expect(isAdminRequest(routeId, path)).toBe(false);
	});
});
