import type { Interval } from '../availability';
import { toBase64Url } from '../auth/tokens';
import type { CalendarClient, CalendarEventInput } from './types';

export interface GoogleEnv {
	GOOGLE_SERVICE_ACCOUNT_JSON?: string;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar';
const TIMEOUT_MS = 5000;
/** Refresh the access token this long before Google says it expires. */
const EXPIRY_MARGIN_MS = 60_000;

const NOT_CONFIGURED = 'Google Calendar is not configured';
const INVALID_ENV = 'GOOGLE_SERVICE_ACCOUNT_JSON is invalid';
export const INVALID_KEY = 'Google service account private key is invalid';

function base64UrlJson(value: unknown): string {
	return toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

/**
 * DER bytes of a PKCS#8 PEM key. Accepts the literal "\n" sequences a service-account JSON
 * pasted into an env var often carries. Errors never include the key material.
 */
function pemToDer(pem: string): Uint8Array {
	const b64 = pem
		.replace(/\\n/g, '\n')
		.replace(/-----BEGIN PRIVATE KEY-----/, '')
		.replace(/-----END PRIVATE KEY-----/, '')
		.replace(/\s+/g, '');
	try {
		return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
	} catch {
		throw new Error(INVALID_KEY);
	}
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
	const der = pemToDer(pem);
	try {
		return await crypto.subtle.importKey(
			'pkcs8',
			der as BufferSource,
			{ name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
			false,
			['sign']
		);
	} catch {
		throw new Error(INVALID_KEY);
	}
}

export async function signServiceAccountJwt(
	clientEmail: string,
	privateKeyPem: string,
	now: Date
): Promise<string> {
	const iat = Math.floor(now.getTime() / 1000);
	const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' });
	const claims = base64UrlJson({
		iss: clientEmail,
		scope: SCOPE,
		aud: TOKEN_URL,
		iat,
		exp: iat + 3600
	});
	const key = await importPrivateKey(privateKeyPem);
	const sig = await crypto.subtle.sign(
		'RSASSA-PKCS1-v1_5',
		key,
		new TextEncoder().encode(`${header}.${claims}`)
	);
	return `${header}.${claims}.${toBase64Url(new Uint8Array(sig))}`;
}

interface ServiceAccount {
	clientEmail: string;
	privateKey: string;
}

function parseServiceAccount(raw: string): ServiceAccount {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		// Don't chain the SyntaxError: its message can quote the value.
		parsed = null;
	}
	const obj = parsed as { client_email?: unknown; private_key?: unknown } | null;
	if (
		typeof obj !== 'object' ||
		obj === null ||
		typeof obj.client_email !== 'string' ||
		!obj.client_email ||
		typeof obj.private_key !== 'string' ||
		!obj.private_key
	) {
		throw new Error(INVALID_ENV);
	}
	return { clientEmail: obj.client_email, privateKey: obj.private_key };
}

function disabledClient(): CalendarClient {
	return {
		enabled: false,
		serviceAccountEmail: null,
		createEvent: async () => {
			throw new Error(NOT_CONFIGURED);
		},
		deleteEvent: async () => {
			throw new Error(NOT_CONFIGURED);
		},
		busy: async () => []
	};
}

interface FreeBusyResponse {
	calendars?: Record<
		string,
		{ busy?: { start: string; end: string }[]; errors?: { reason?: string }[] }
	>;
}

export function createCalendarClient(
	env: GoogleEnv,
	opts: { fetchFn?: typeof fetch; now?: () => Date } = {}
): CalendarClient {
	if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) return disabledClient();
	const account = parseServiceAccount(env.GOOGLE_SERVICE_ACCOUNT_JSON);
	const fetchFn = opts.fetchFn ?? fetch;
	const now = opts.now ?? (() => new Date());

	let cached: { token: string; refreshAt: number } | null = null;
	let pending: Promise<string> | null = null;

	async function fetchToken(): Promise<string> {
		const issuedAt = now();
		const assertion = await signServiceAccountJwt(
			account.clientEmail,
			account.privateKey,
			issuedAt
		);
		const res = await fetchFn(TOKEN_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
				assertion
			}).toString(),
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
		if (!res.ok) throw new Error(`Google API ${res.status} /token`);
		const data = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
		if (typeof data.access_token !== 'string' || typeof data.expires_in !== 'number') {
			throw new Error('Google API returned an invalid token response');
		}
		cached = {
			token: data.access_token,
			refreshAt: issuedAt.getTime() + data.expires_in * 1000 - EXPIRY_MARGIN_MS
		};
		return data.access_token;
	}

	function accessToken(): Promise<string> {
		if (cached && now().getTime() < cached.refreshAt) return Promise.resolve(cached.token);
		// Share one in-flight exchange between concurrent callers.
		pending ??= fetchToken().finally(() => {
			pending = null;
		});
		return pending;
	}

	async function request(method: string, url: string, body?: unknown): Promise<Response> {
		const token = await accessToken();
		const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
		if (body !== undefined) headers['Content-Type'] = 'application/json';
		return fetchFn(url, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	}

	function apiError(res: Response, url: string): Error {
		return new Error(`Google API ${res.status} ${new URL(url).pathname}`);
	}

	const eventsUrl = (calendarId: string) =>
		`${API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;

	return {
		enabled: true,
		serviceAccountEmail: account.clientEmail,

		async createEvent(calendarId: string, event: CalendarEventInput): Promise<string> {
			const url = eventsUrl(calendarId);
			const res = await request('POST', url, {
				summary: event.summary,
				description: event.description,
				start: { dateTime: event.start.toISOString(), timeZone: event.timeZone },
				end: { dateTime: event.end.toISOString(), timeZone: event.timeZone }
			});
			if (!res.ok) throw apiError(res, url);
			const data = (await res.json()) as { id?: unknown };
			if (typeof data.id !== 'string' || !data.id) {
				throw new Error('Google API returned no event id');
			}
			return data.id;
		},

		async deleteEvent(calendarId: string, eventId: string): Promise<void> {
			const url = `${eventsUrl(calendarId)}/${encodeURIComponent(eventId)}`;
			const res = await request('DELETE', url);
			if (res.ok || res.status === 404 || res.status === 410) return;
			throw apiError(res, url);
		},

		async busy(calendarIds: string[], from: Date, to: Date): Promise<Interval[]> {
			if (calendarIds.length === 0) return [];
			const url = `${API_BASE}/freeBusy`;
			const res = await request('POST', url, {
				timeMin: from.toISOString(),
				timeMax: to.toISOString(),
				items: calendarIds.map((id) => ({ id }))
			});
			if (!res.ok) throw apiError(res, url);
			const data = (await res.json()) as FreeBusyResponse;
			const intervals: Interval[] = [];
			for (const id of calendarIds) {
				const cal = data.calendars?.[id];
				if (!cal) throw new Error(`Free/busy failed for calendar ${id}: missing`);
				if (cal.errors?.length) {
					throw new Error(
						`Free/busy failed for calendar ${id}: ${cal.errors[0].reason ?? 'unknown'}`
					);
				}
				for (const b of cal.busy ?? []) {
					intervals.push({ start: new Date(b.start), end: new Date(b.end) });
				}
			}
			return intervals.sort((a, b) => a.start.getTime() - b.start.getTime());
		}
	};
}
