export type CronAuth = { ok: true } | { ok: false; status: 401 | 503 };

const encoder = new TextEncoder();

async function digest(value: string): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

/**
 * Checks `Authorization: Bearer {secret}`. An unset or empty secret disables the endpoint (503).
 * Both sides are hashed to a fixed length, then compared without early exit, so neither the
 * secret's content nor its length leaks through timing.
 */
export async function checkCronAuth(
	header: string | null,
	secret: string | undefined
): Promise<CronAuth> {
	if (!secret) return { ok: false, status: 503 };
	const [given, expected] = await Promise.all([digest(header ?? ''), digest(`Bearer ${secret}`)]);
	let diff = 0;
	for (let i = 0; i < expected.length; i++) diff |= given[i] ^ expected[i];
	return diff === 0 && header !== null ? { ok: true } : { ok: false, status: 401 };
}
