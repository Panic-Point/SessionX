import { describe, expect, it } from 'vitest';
import { COMMON_PASSWORDS } from './common-passwords';
import { hashPassword, passwordProblem, verifyPassword, verifyPasswordOrDummy } from './password';

describe('passwordProblem', () => {
	it('requires 10 to 128 characters with no composition rules', () => {
		expect(passwordProblem('a'.repeat(9))).toMatch(/at least 10/);
		expect(passwordProblem('correct horse')).toBeNull();
		expect(passwordProblem('zzzzzzzzzzzzzzzzzzzz')).toBeNull();
		expect(passwordProblem('x'.repeat(128))).toBeNull();
		expect(passwordProblem('x'.repeat(129))).toMatch(/at most 128/);
	});

	it('rejects common passwords case-insensitively', () => {
		expect(passwordProblem('qwertyuiop')).toMatch(/too common/);
		expect(passwordProblem('Password123')).toMatch(/too common/);
		expect(passwordProblem('1234567890')).toMatch(/too common/);
	});

	it('bundles 1,000 lowercase entries that the length rule would not already reject', () => {
		expect(COMMON_PASSWORDS).toHaveLength(1000);
		expect(new Set(COMMON_PASSWORDS).size).toBe(1000);
		for (const p of COMMON_PASSWORDS) {
			expect(p.length).toBeGreaterThanOrEqual(10);
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
