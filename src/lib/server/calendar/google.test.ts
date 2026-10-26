import { beforeAll, describe, expect, it } from 'vitest';
import { fromBase64Url } from '../auth/tokens';
import { createCalendarClient, signServiceAccountJwt } from './google';

const CLIENT_EMAIL = 'sessionx@project.iam.gserviceaccount.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';

let pem: string;
let publicKey: CryptoKey;

beforeAll(async () => {
	const pair = await crypto.subtle.generateKey(
		{
			name: 'RSASSA-PKCS1-v1_5',
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: 'SHA-256'
		},
		true,
		['sign', 'verify']
	);
	publicKey = pair.publicKey;
	const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
	let bin = '';
	for (const b of der) bin += String.fromCharCode(b);
	const b64 = btoa(bin);
	const lines = b64.match(/.{1,64}/g) ?? [];
	pem = `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----\n`;
});

function decodeJson(part: string): Record<string, unknown> {
	const bytes = fromBase64Url(part);
	if (!bytes) throw new Error('bad base64url');
	return JSON.parse(new TextDecoder().decode(bytes));
}

async function verifyJwt(jwt: string): Promise<boolean> {
	const [h, c, s] = jwt.split('.');
	const sig = fromBase64Url(s);
	if (!sig) return false;
	return crypto.subtle.verify(
		'RSASSA-PKCS1-v1_5',
		publicKey,
		sig as BufferSource,
		new TextEncoder().encode(`${h}.${c}`)
	);
}

interface Call {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: string | undefined;
	signal: AbortSignal | undefined;
}

type Responder = (call: Call) => Response;

/** Fake fetch routing by "METHOD url"; records every call. */
function fakeFetch(routes: Record<string, Responder>) {
	const calls: Call[] = [];
	let tokenCount = 0;
	const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		const headers: Record<string, string> = {};
		new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
		const call: Call = {
			url,
			method,
			headers,
			body: typeof init?.body === 'string' ? init.body : undefined,
			signal: init?.signal ?? undefined
		};
		calls.push(call);
		const key = `${method} ${url}`;
		if (key === `POST ${TOKEN_URL}` && !routes[key]) {
			tokenCount++;
			return Response.json({
				access_token: `token-${tokenCount}`,
				expires_in: 3600,
				token_type: 'Bearer'
			});
		}
		const route = routes[key];
		if (!route) return new Response('not found', { status: 599 });
		return route(call);
	}) as typeof fetch;
	return { fetchFn, calls };
}

function envFor(key = pem) {
	return {
		GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
			type: 'service_account',
			client_email: CLIENT_EMAIL,
			private_key: key
		})
	};
}

const NOW = new Date('2026-10-26T10:00:00Z');

describe('signServiceAccountJwt', () => {
	it('signs a JWT verifiable with the public key and correct claims', async () => {
		const jwt = await signServiceAccountJwt(CLIENT_EMAIL, pem, NOW);
		const [h, c] = jwt.split('.');
		expect(jwt.split('.')).toHaveLength(3);
		expect(decodeJson(h)).toEqual({ alg: 'RS256', typ: 'JWT' });
		const iat = Math.floor(NOW.getTime() / 1000);
		expect(decodeJson(c)).toEqual({
			iss: CLIENT_EMAIL,
			scope: 'https://www.googleapis.com/auth/calendar',
			aud: 'https://oauth2.googleapis.com/token',
			iat,
			exp: iat + 3600
		});
		expect(await verifyJwt(jwt)).toBe(true);
	});

	it('normalises escaped newlines in the key', async () => {
		const escaped = pem.replace(/\n/g, '\\n');
		expect(escaped).not.toContain('\n');
		const jwt = await signServiceAccountJwt(CLIENT_EMAIL, escaped, NOW);
		expect(await verifyJwt(jwt)).toBe(true);
	});
});

describe('createCalendarClient', () => {
	it('exchanges JWT for a token and caches it', async () => {
		const { fetchFn, calls } = fakeFetch({
			[`POST ${API}/freeBusy`]: () => Response.json({ calendars: { a: { busy: [] } } })
		});
		const client = createCalendarClient(envFor(), { fetchFn, now: () => NOW });
		expect(client.enabled).toBe(true);
		expect(client.serviceAccountEmail).toBe(CLIENT_EMAIL);

		await client.busy(['a'], NOW, new Date('2026-10-27T10:00:00Z'));
		await client.busy(['a'], NOW, new Date('2026-10-27T10:00:00Z'));

		const tokenCalls = calls.filter((c) => c.url === TOKEN_URL);
		expect(tokenCalls).toHaveLength(1);
		expect(tokenCalls[0].method).toBe('POST');
		expect(tokenCalls[0].headers['content-type']).toBe('application/x-www-form-urlencoded');
		const form = new URLSearchParams(tokenCalls[0].body);
		expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
		const assertion = form.get('assertion') ?? '';
		expect(await verifyJwt(assertion)).toBe(true);
		expect(decodeJson(assertion.split('.')[1]).iss).toBe(CLIENT_EMAIL);

		const apiCalls = calls.filter((c) => c.url !== TOKEN_URL);
		expect(apiCalls).toHaveLength(2);
		for (const c of apiCalls) expect(c.headers['authorization']).toBe('Bearer token-1');
	});

	it('refreshes the token after expiry', async () => {
		const { fetchFn, calls } = fakeFetch({
			[`POST ${API}/freeBusy`]: () => Response.json({ calendars: { a: { busy: [] } } })
		});
		let now = NOW;
		const client = createCalendarClient(envFor(), { fetchFn, now: () => now });
		const to = new Date('2026-10-27T10:00:00Z');

		await client.busy(['a'], NOW, to);
		// Still inside the window: expires_in 3600 minus the 60 s margin.
		now = new Date(NOW.getTime() + 3539_000);
		await client.busy(['a'], NOW, to);
		expect(calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(1);

		now = new Date(NOW.getTime() + 3540_000);
		await client.busy(['a'], NOW, to);
		expect(calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(2);
		expect(calls.at(-1)?.headers['authorization']).toBe('Bearer token-2');
	});

	it('createEvent posts the event and returns its id', async () => {
		const calendarId = 'tutor@example.com';
		const url = `${API}/calendars/${encodeURIComponent(calendarId)}/events`;
		const { fetchFn, calls } = fakeFetch({
			[`POST ${url}`]: () => Response.json({ id: 'evt123', status: 'confirmed' })
		});
		const client = createCalendarClient(envFor(), { fetchFn, now: () => NOW });
		const start = new Date('2026-11-02T15:00:00Z');
		const end = new Date('2026-11-02T16:00:00Z');

		const id = await client.createEvent(calendarId, {
			summary: 'Lesson: Ada',
			description: 'Piano',
			start,
			end,
			timeZone: 'Europe/London'
		});

		expect(id).toBe('evt123');
		const call = calls.find((c) => c.url === url);
		expect(call?.method).toBe('POST');
		expect(call?.headers['authorization']).toBe('Bearer token-1');
		expect(call?.headers['content-type']).toBe('application/json');
		expect(JSON.parse(call?.body ?? '')).toEqual({
			summary: 'Lesson: Ada',
			description: 'Piano',
			start: { dateTime: start.toISOString(), timeZone: 'Europe/London' },
			end: { dateTime: end.toISOString(), timeZone: 'Europe/London' }
		});
	});

	it('deleteEvent treats 404 and 410 as success', async () => {
		const base = `${API}/calendars/${encodeURIComponent('cal/1')}/events`;
		const { fetchFn, calls } = fakeFetch({
			[`DELETE ${base}/${encodeURIComponent('gone 1')}`]: () => new Response(null, { status: 404 }),
			[`DELETE ${base}/gone2`]: () => new Response(null, { status: 410 }),
			[`DELETE ${base}/ok`]: () => new Response(null, { status: 204 })
		});
		const client = createCalendarClient(envFor(), { fetchFn, now: () => NOW });

		await expect(client.deleteEvent('cal/1', 'gone 1')).resolves.toBeUndefined();
		await expect(client.deleteEvent('cal/1', 'gone2')).resolves.toBeUndefined();
		await expect(client.deleteEvent('cal/1', 'ok')).resolves.toBeUndefined();
		const deletes = calls.filter((c) => c.method === 'DELETE');
		expect(deletes.map((c) => c.url)).toEqual([`${base}/gone%201`, `${base}/gone2`, `${base}/ok`]);
		for (const c of deletes) expect(c.headers['authorization']).toBe('Bearer token-1');
	});

	it('deleteEvent throws on 500', async () => {
		const path = `/calendar/v3/calendars/cal/events/e1`;
		const { fetchFn } = fakeFetch({
			[`DELETE https://www.googleapis.com${path}`]: () =>
				new Response('secret upstream detail', { status: 500 })
		});
		const client = createCalendarClient(envFor(), { fetchFn, now: () => NOW });

		const err = await client.deleteEvent('cal', 'e1').catch((e: Error) => e);
		expect(err).toBeInstanceOf(Error);
		expect((err as Error).message).toBe(`Google API 500 ${path}`);
		expect((err as Error).message).not.toContain('secret upstream detail');
	});

	it('busy merges intervals across calendars', async () => {
		const from = new Date('2026-11-02T00:00:00Z');
		const to = new Date('2026-11-03T00:00:00Z');
		const { fetchFn, calls } = fakeFetch({
			[`POST ${API}/freeBusy`]: () =>
				Response.json({
					kind: 'calendar#freeBusy',
					calendars: {
						a: {
							busy: [
								{ start: '2026-11-02T14:00:00Z', end: '2026-11-02T15:00:00Z' },
								{ start: '2026-11-02T09:00:00Z', end: '2026-11-02T10:00:00Z' }
							]
						},
						b: { busy: [{ start: '2026-11-02T12:00:00Z', end: '2026-11-02T13:30:00Z' }] }
					}
				})
		});
		const client = createCalendarClient(envFor(), { fetchFn, now: () => NOW });

		const busy = await client.busy(['a', 'b'], from, to);

		expect(busy).toEqual([
			{ start: new Date('2026-11-02T09:00:00Z'), end: new Date('2026-11-02T10:00:00Z') },
			{ start: new Date('2026-11-02T12:00:00Z'), end: new Date('2026-11-02T13:30:00Z') },
			{ start: new Date('2026-11-02T14:00:00Z'), end: new Date('2026-11-02T15:00:00Z') }
		]);
		const call = calls.find((c) => c.url === `${API}/freeBusy`);
		expect(call?.method).toBe('POST');
		expect(call?.headers['authorization']).toBe('Bearer token-1');
		expect(JSON.parse(call?.body ?? '')).toEqual({
			timeMin: from.toISOString(),
			timeMax: to.toISOString(),
			items: [{ id: 'a' }, { id: 'b' }]
		});
	});

	it('busy returns [] for no calendars without calling Google', async () => {
		const { fetchFn, calls } = fakeFetch({});
		const client = createCalendarClient(envFor(), { fetchFn, now: () => NOW });

		expect(await client.busy([], NOW, new Date('2026-10-27T10:00:00Z'))).toEqual([]);
		expect(calls).toHaveLength(0);
	});

	it('busy throws when a calendar reports errors', async () => {
		const { fetchFn } = fakeFetch({
			[`POST ${API}/freeBusy`]: () =>
				Response.json({
					calendars: {
						a: { busy: [] },
						'b@example.com': { errors: [{ domain: 'global', reason: 'notFound' }], busy: [] }
					}
				})
		});
		const client = createCalendarClient(envFor(), { fetchFn, now: () => NOW });

		await expect(
			client.busy(['a', 'b@example.com'], NOW, new Date('2026-10-27T10:00:00Z'))
		).rejects.toThrow('Free/busy failed for calendar b@example.com: notFound');
	});

	it('disabled client when env unset', async () => {
		const { fetchFn, calls } = fakeFetch({});
		for (const env of [{}, { GOOGLE_SERVICE_ACCOUNT_JSON: '' }]) {
			const client = createCalendarClient(env, { fetchFn, now: () => NOW });
			expect(client.enabled).toBe(false);
			expect(client.serviceAccountEmail).toBeNull();
			expect(await client.busy(['a'], NOW, new Date('2026-10-27T10:00:00Z'))).toEqual([]);
			const event = {
				summary: 's',
				description: 'd',
				start: NOW,
				end: NOW,
				timeZone: 'Europe/London'
			};
			await expect(client.createEvent('a', event)).rejects.toThrow(
				'Google Calendar is not configured'
			);
			await expect(client.deleteEvent('a', 'e')).rejects.toThrow(
				'Google Calendar is not configured'
			);
		}
		expect(calls).toHaveLength(0);
	});

	it('invalid JSON throws without echoing the value', () => {
		const values = [
			'not-json-SENSITIVE',
			JSON.stringify({ client_email: CLIENT_EMAIL, note: 'SENSITIVE' }),
			JSON.stringify({ private_key: 'SENSITIVE' }),
			JSON.stringify({ client_email: 42, private_key: 'SENSITIVE' }),
			'"SENSITIVE"',
			'null'
		];
		for (const value of values) {
			let err: unknown;
			try {
				createCalendarClient({ GOOGLE_SERVICE_ACCOUNT_JSON: value });
			} catch (e) {
				err = e;
			}
			expect(err).toBeInstanceOf(Error);
			expect((err as Error).message).toBe('GOOGLE_SERVICE_ACCOUNT_JSON is invalid');
			expect(String((err as Error).stack)).not.toContain('SENSITIVE');
			expect((err as Error).cause).toBeUndefined();
		}
	});

	it('errors never include the private key', async () => {
		const keyBody = pem
			.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '')
			.replace(/\s+/g, '')
			.slice(0, 40);
		const raw = envFor().GOOGLE_SERVICE_ACCOUNT_JSON;
		const leaks = (e: unknown) => {
			const text = `${String(e)} ${(e as Error)?.stack ?? ''} ${JSON.stringify(e)}`;
			return text.includes(keyBody) || text.includes(raw) || text.includes('PRIVATE KEY');
		};
		const errors: unknown[] = [];

		// Token endpoint rejects the assertion.
		const rejected = fakeFetch({
			[`POST ${TOKEN_URL}`]: () =>
				new Response(JSON.stringify({ error: 'invalid_grant' }), {
					status: 400
				})
		});
		const c1 = createCalendarClient(envFor(), { fetchFn: rejected.fetchFn, now: () => NOW });
		errors.push(await c1.deleteEvent('cal', 'e').catch((e) => e));

		// Key that is not a valid PKCS#8 key.
		const bogus = '-----BEGIN PRIVATE KEY-----\nAAAA' + keyBody + '\n-----END PRIVATE KEY-----';
		const c2 = createCalendarClient(envFor(bogus), { fetchFn: rejected.fetchFn, now: () => NOW });
		errors.push(await c2.deleteEvent('cal', 'e').catch((e) => e));
		errors.push(await signServiceAccountJwt(CLIENT_EMAIL, bogus, NOW).catch((e) => e));

		// API failure after a good token.
		const failing = fakeFetch({
			[`POST ${API}/freeBusy`]: () => new Response(pem, { status: 500 })
		});
		const c3 = createCalendarClient(envFor(), { fetchFn: failing.fetchFn, now: () => NOW });
		errors.push(await c3.busy(['a'], NOW, NOW).catch((e) => e));

		expect(errors).toHaveLength(4);
		for (const e of errors) {
			expect(e).toBeInstanceOf(Error);
			expect(leaks(e)).toBe(false);
			expect(leaks((e as Error).cause)).toBe(false);
		}
	});

	it('requests use an abort timeout', async () => {
		const { fetchFn, calls } = fakeFetch({
			[`POST ${API}/calendars/c/events`]: () => Response.json({ id: 'x' }),
			[`DELETE ${API}/calendars/c/events/x`]: () => new Response(null, { status: 204 }),
			[`POST ${API}/freeBusy`]: () => Response.json({ calendars: { c: { busy: [] } } })
		});
		const client = createCalendarClient(envFor(), { fetchFn, now: () => NOW });

		await client.createEvent('c', {
			summary: 's',
			description: 'd',
			start: NOW,
			end: NOW,
			timeZone: 'UTC'
		});
		await client.deleteEvent('c', 'x');
		await client.busy(['c'], NOW, NOW);

		expect(calls).toHaveLength(4);
		for (const c of calls) {
			expect(c.signal).toBeInstanceOf(AbortSignal);
			expect(c.signal?.aborted).toBe(false);
		}
	});
});
