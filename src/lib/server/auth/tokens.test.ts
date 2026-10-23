import { describe, expect, it } from 'vitest';
import { generateToken, hashToken } from './tokens';

describe('tokens', () => {
	it('generates 43-char url-safe tokens', () => {
		const t = generateToken();
		expect(t).toHaveLength(43);
		expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
	});
	it('generates unique tokens', () => {
		expect(generateToken()).not.toBe(generateToken());
	});
	it('hashes with SHA-256 hex', async () => {
		expect(await hashToken('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
	});
});
