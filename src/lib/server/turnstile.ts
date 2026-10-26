const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type TurnstileResult = { ok: true } | { ok: false; reason: 'missing' | 'rejected' };

/**
 * Verify a Cloudflare Turnstile token. An unset secret disables the check. Failures of siteverify
 * itself (network, timeout, non-2xx) fail open so an outage never blocks bookings; the secret is
 * never logged.
 */
export async function verifyTurnstile(
	token: string | null,
	remoteIp: string | null,
	secret: string | undefined,
	fetchFn: typeof fetch = fetch
): Promise<TurnstileResult> {
	if (!secret) return { ok: true };
	if (!token) return { ok: false, reason: 'missing' };

	const body = new URLSearchParams({ secret, response: token });
	if (remoteIp) body.set('remoteip', remoteIp);

	try {
		const res = await fetchFn(SITEVERIFY_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body,
			signal: AbortSignal.timeout(5000)
		});
		if (!res.ok) throw new Error(`Turnstile siteverify failed: ${res.status}`);
		const result = (await res.json()) as { success?: boolean };
		return result.success === true ? { ok: true } : { ok: false, reason: 'rejected' };
	} catch (e) {
		console.error(
			`Turnstile verification unavailable, allowing submit: ${e instanceof Error ? e.message : 'unknown error'}`
		);
		return { ok: true };
	}
}
