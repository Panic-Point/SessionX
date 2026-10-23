export function toBase64Url(bytes: Uint8Array): string {
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array | null {
	if (!/^[A-Za-z0-9_-]*={0,2}$/.test(s)) return null;
	let b64 = s.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
	if (b64.length % 4 === 1) return null;
	while (b64.length % 4) b64 += '=';
	try {
		return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
	} catch {
		return null;
	}
}

/** 32 random bytes, base64url, no padding. */
export function generateToken(): string {
	return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

/** SHA-256, lowercase hex. */
export async function hashToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
