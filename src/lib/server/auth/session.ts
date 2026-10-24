import { fromBase64Url, toBase64Url } from './tokens';

export const SESSION_COOKIE = 'sx_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface SessionPayload {
	accountId: string;
	/** Expiry, seconds since epoch. */
	exp: number;
}

function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		[usage]
	);
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
	const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
	const sig = await crypto.subtle.sign(
		'HMAC',
		await hmacKey(secret, 'sign'),
		new TextEncoder().encode(body)
	);
	return `${body}.${toBase64Url(new Uint8Array(sig))}`;
}

export async function verifySession(
	cookie: string | undefined,
	secret: string,
	now: Date
): Promise<SessionPayload | null> {
	if (!cookie) return null;
	const parts = cookie.split('.');
	if (parts.length !== 2) return null;
	const [body, sigPart] = parts;
	const sig = fromBase64Url(sigPart);
	const raw = fromBase64Url(body);
	if (!sig || !raw) return null;
	const ok = await crypto.subtle.verify(
		'HMAC',
		await hmacKey(secret, 'verify'),
		sig as BufferSource,
		new TextEncoder().encode(body)
	);
	if (!ok) return null;
	try {
		const p = JSON.parse(new TextDecoder().decode(raw));
		if (typeof p?.accountId !== 'string' || typeof p?.exp !== 'number') return null;
		if (p.exp * 1000 <= now.getTime()) return null;
		return { accountId: p.accountId, exp: p.exp };
	} catch {
		return null;
	}
}
