import { TURNSTILE_SECRET_KEY, TURNSTILE_SITE_KEY } from '$app/env/private';
import { formString } from './admin-actions';
import { verifyTurnstile } from './turnstile';

/** The site key for the page, only when both keys are configured. */
export function turnstileSiteKey(): string | undefined {
	return TURNSTILE_SITE_KEY && TURNSTILE_SECRET_KEY ? TURNSTILE_SITE_KEY : undefined;
}

/** Checks a form's Turnstile response; passes when Turnstile isn't configured. */
export async function passesTurnstile(
	data: FormData,
	getClientAddress: () => string
): Promise<boolean> {
	let remoteIp: string | null = null;
	try {
		remoteIp = getClientAddress();
	} catch {
		// No client address available (some adapters/local runs); siteverify accepts it absent.
	}
	const result = await verifyTurnstile(
		formString(data, 'cf-turnstile-response') || null,
		remoteIp,
		TURNSTILE_SITE_KEY ? TURNSTILE_SECRET_KEY : undefined
	);
	return result.ok;
}

export const TURNSTILE_FAILED = 'Please complete the spam check and try again.';
