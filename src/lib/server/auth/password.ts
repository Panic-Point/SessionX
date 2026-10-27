import { COMMON_PASSWORDS } from './common-passwords';
import { fromBase64Url, toBase64Url } from './tokens';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** Cloudflare Workers caps PBKDF2 at 100,000 iterations. */
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;
const SCHEME = 'pbkdf2-sha256';

const common = new Set(COMMON_PASSWORDS);

/** A field error for a new password, or null when it is acceptable. No composition rules. */
export function passwordProblem(password: string): string | null {
	if (password.length < PASSWORD_MIN_LENGTH) {
		return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
	}
	if (password.length > PASSWORD_MAX_LENGTH) {
		return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
	}
	if (common.has(password.toLowerCase())) {
		return 'That password is too common. Choose something harder to guess.';
	}
	return null;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(password),
		'PBKDF2',
		false,
		['deriveBits']
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
		key,
		HASH_BITS
	);
	return new Uint8Array(bits);
}

/** `pbkdf2-sha256$<iterations>$<salt>$<hash>`, salt and hash base64url. */
export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	const hash = await derive(password, salt, ITERATIONS);
	return `${SCHEME}$${ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}

/** False for a wrong password or a malformed stored hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const parts = stored.split('$');
	if (parts.length !== 4 || parts[0] !== SCHEME) return false;
	const iterations = Number(parts[1]);
	const salt = fromBase64Url(parts[2]);
	const expected = fromBase64Url(parts[3]);
	if (!Number.isInteger(iterations) || iterations < 1 || iterations > ITERATIONS) return false;
	if (!salt || !expected || expected.length === 0) return false;
	return constantTimeEqual(await derive(password, salt, iterations), expected);
}

let dummyHash: Promise<string> | undefined;

/**
 * Checks `password` against `stored`, or against a throwaway hash when there is none, so a
 * missing account or password costs the same time as a wrong password.
 */
export async function verifyPasswordOrDummy(
	password: string,
	stored: string | null
): Promise<boolean> {
	if (stored) return verifyPassword(password, stored);
	dummyHash ??= hashPassword(toBase64Url(crypto.getRandomValues(new Uint8Array(16))));
	await verifyPassword(password, await dummyHash);
	return false;
}
