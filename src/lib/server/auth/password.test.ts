import { describe, expect, it } from 'vitest';
import { COMMON_PASSWORDS } from './common-passwords';
import { hashPassword, passwordProblem, verifyPassword, verifyPasswordOrDummy } from './password';

describe('passwordProblem', () => {
	it('accepts 8 to 128 characters with a number and a special character', () => {
		expect(passwordProblem('Abcdef1!')).toBeNull();
		expect(passwordProblem('correct horse 9 battery?')).toBeNull();
		expect(passwordProblem('1#' + 'x'.repeat(126))).toBeNull();
	});

	it('reports one problem at a time, in order', () => {
		expect(passwordProblem('Abc1!')).toBe('Use at least 8 characters.');
		expect(passwordProblem('1#' + 'x'.repeat(127))).toBe('Use at most 128 characters.');
		expect(passwordProblem('Abcdefg!')).toBe('Include at least one number.');
		expect(passwordProblem('Abcdefg1')).toBe(
			'Include at least one special character, like ! or #.'
		);
		expect(passwordProblem('x')).toBe('Use at least 8 characters.');
	});

	it('does not count accented letters, other scripts or spaces as special', () => {
		expect(passwordProblem('Ångström1')).toMatch(/special character/);
		expect(passwordProblem('пароль123')).toMatch(/special character/);
		expect(passwordProblem('abc def 1')).toMatch(/special character/);
		expect(passwordProblem('Ångström1€')).toBeNull();
	});

	it('rejects common passwords case-insensitively', () => {
		expect(passwordProblem('p030710p$e4o')).toMatch(/too common/);
		expect(passwordProblem('P030710P$E4O')).toMatch(/too common/);
		expect(passwordProblem('1234567890-')).toMatch(/too common/);
	});

	it('bundles 1,000 lowercase entries that the length rule would not already reject', () => {
		expect(COMMON_PASSWORDS).toHaveLength(1000);
		expect(new Set(COMMON_PASSWORDS).size).toBe(1000);
		for (const p of COMMON_PASSWORDS) {
			expect(p.length).toBeGreaterThanOrEqual(8);
			expect(p).toBe(p.toLowerCase());
		}
	});
});

describe('hashPassword / verifyPassword', () => {
	it('stores a self-describing PBKDF2 string with a random salt', async () => {
		const a = await hashPassword('correct horse battery');
		const b = await hashPassword('correct horse battery');
		expect(a).toMatch(/^pbkdf2-sha256\$100000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
		expect(a).not.toBe(b);
	});

	it('verifies the right password and rejects others', async () => {
		const stored = await hashPassword('correct horse battery');
		expect(await verifyPassword('correct horse battery', stored)).toBe(true);
		expect(await verifyPassword('correct horse batterY', stored)).toBe(false);
		expect(await verifyPassword('', stored)).toBe(false);
	});

	it('rejects malformed or foreign stored hashes', async () => {
		const stored = await hashPassword('correct horse battery');
		const [, iter, salt, hash] = stored.split('$');
		expect(await verifyPassword('correct horse battery', '')).toBe(false);
		expect(await verifyPassword('correct horse battery', `bcrypt$${iter}$${salt}$${hash}`)).toBe(
			false
		);
		expect(await verifyPassword('correct horse battery', `pbkdf2-sha256$abc$${salt}$${hash}`)).toBe(
			false
		);
		expect(
			await verifyPassword('correct horse battery', `pbkdf2-sha256$999999$${salt}$${hash}`)
		).toBe(false);
		expect(await verifyPassword('correct horse battery', `pbkdf2-sha256$${iter}$!!$${hash}`)).toBe(
			false
		);
		expect(await verifyPassword('correct horse battery', `pbkdf2-sha256$${iter}$${salt}$`)).toBe(
			false
		);
		expect(await verifyPassword('correct horse battery', `${stored}$extra`)).toBe(false);
	});

	it('verifies hashes made with fewer iterations, so the cost can change later', async () => {
		// PBKDF2-SHA256("password", "salt", 1 iteration, 32 bytes), checked against Node's crypto.
		const salt = 'c2FsdA';
		const hash = 'Eg-2z_z4syxD5yJSVsT4N6hlSMkszDVICAWYfLcL4Xs';
		expect(await verifyPassword('password', `pbkdf2-sha256$1$${salt}$${hash}`)).toBe(true);
	});

	it('verifyPasswordOrDummy is false with no stored hash', async () => {
		expect(await verifyPasswordOrDummy('anything at all', null)).toBe(false);
		const stored = await hashPassword('correct horse battery');
		expect(await verifyPasswordOrDummy('correct horse battery', stored)).toBe(true);
	});
});
