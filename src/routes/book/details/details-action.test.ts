import { isActionFailure, isRedirect } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completeRegistration } from '#lib/server/auth/password-service.ts';
import { generateToken, hashToken } from '#lib/server/auth/tokens.ts';
import { fakeCalendar, type FakeCalendar } from '#lib/server/calendar/fake-client.test-helpers.ts';
import type { EmailMessage } from '#lib/server/email/mailer.ts';
import { MemoryBookingStore } from '#lib/server/store/memory.ts';
import type { Account } from '#lib/server/store/types.ts';

const ctx = vi.hoisted(() => ({
	store: undefined as unknown as MemoryBookingStore,
	sent: [] as EmailMessage[],
	calendar: undefined as unknown as FakeCalendar,
	env: { TURNSTILE_SITE_KEY: undefined, TURNSTILE_SECRET_KEY: undefined } as {
		TURNSTILE_SITE_KEY: string | undefined;
		TURNSTILE_SECRET_KEY: string | undefined;
	}
}));
vi.mock('$app/env/private', () => ({
	get TURNSTILE_SITE_KEY() {
		return ctx.env.TURNSTILE_SITE_KEY;
	},
	get TURNSTILE_SECRET_KEY() {
		return ctx.env.TURNSTILE_SECRET_KEY;
	}
}));
vi.mock('#lib/server/context.ts', () => ({
	getStore: () => ctx.store,
	getMailer: () => ({ send: async (m: EmailMessage) => void ctx.sent.push(m) }),
	getAppUrl: () => 'https://example.test',
	getCalendar: () => ctx.calendar
}));

const { actions, load } = await import('./+page.server');
const accountPage = await import('../../account/+page.server');

const LESSON_30 = '11111111-0000-0000-0000-000000000030';
const AVA = '33333333-0000-0000-0000-0000000000a1';
const pat: Account = {
	id: '22222222-0000-0000-0000-00000000000b',
	name: 'Pat Parent',
	email: 'parent@example.com',
	role: 'client'
};
const LIMIT =
	'You already have 2 lesson requests waiting for approval. Please wait for a reply before requesting more.';

/** A bookable weekday slot at least 3 days out, from 23:00 UTC (afternoon in Los Angeles). */
function slot(offsetMin: number): string {
	const d = new Date();
	d.setUTCDate(d.getUTCDate() + 3);
	while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
	d.setUTCHours(23, offsetMin, 0, 0);
	return d.toISOString();
}

async function submit(startsAt: string, account = pat, studentId = AVA): Promise<unknown> {
	const body = new FormData();
	body.set('lessonTypeId', LESSON_30);
	body.set('startsAt', startsAt);
	body.set('studentId', studentId);
	body.set('note', '');
	const event = {
		locals: { account },
		request: new Request('http://localhost/book/details', { method: 'POST', body })
	};
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return await (actions.default as any)(event);
	} catch (e) {
		return e;
	}
}

describe('/book/details action, signed in', () => {
	beforeEach(() => {
		ctx.store = new MemoryBookingStore();
		ctx.sent = [];
		ctx.calendar = fakeCalendar(false);
	});

	it('reports the pending-request limit as a form error, not as an unavailable time', async () => {
		expect(isRedirect(await submit(slot(0)))).toBe(true);
		expect(isRedirect(await submit(slot(30)))).toBe(true);
		const result = await submit(slot(60));
		expect(isActionFailure(result)).toBe(true);
		const data = (result as { data: { errors: Record<string, string> } }).data;
		expect(data.errors).toEqual({ form: LIMIT });
		expect(data.errors.startsAt).toBeUndefined();
	});
});

describe('/book/details action, newly registered', () => {
	beforeEach(() => {
		ctx.store = new MemoryBookingStore();
		ctx.sent = [];
		ctx.calendar = fakeCalendar(false);
	});

	it('a new account can book for its holder without adding a student first', async () => {
		const token = generateToken();
		await ctx.store.createPasswordToken(
			await hashToken(token),
			{ purpose: 'register', email: 'robin@example.com' },
			new Date(Date.now() + 60_000)
		);
		const done = await completeRegistration(
			ctx.store,
			token,
			{
				name: 'Robin',
				password: 'a brand new passphrase 9!',
				confirmPassword: 'a brand new passphrase 9!'
			},
			new Date()
		);
		if (!done.ok) throw new Error('registration failed');
		const robin = done.account;

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const home = (await (accountPage.load as any)({
			locals: { account: robin },
			url: new URL('http://localhost/account')
		})) as { students: { id: string; name: string }[] };
		expect(home.students).toEqual([{ id: expect.any(String), name: 'Robin' }]);

		const result = await submit(slot(0), robin, home.students[0].id);
		expect(isRedirect(result)).toBe(true);
		const bookings = await ctx.store.listAccountBookings(robin.id);
		expect(bookings).toHaveLength(1);
		expect(bookings[0]).toMatchObject({ studentName: 'Robin' });
	});
});

describe('/book/details action, calendar wiring', () => {
	beforeEach(() => {
		ctx.store = new MemoryBookingStore();
		ctx.sent = [];
		ctx.calendar = fakeCalendar();
	});

	it('treats a time that is busy on a Google calendar as unavailable', async () => {
		await ctx.store.updateSettings({
			...(await ctx.store.getSettings()),
			gcalBusyCalendarIds: ['busy@x.com']
		});
		const start = new Date(slot(0));
		ctx.calendar.busyIntervals = [{ start, end: new Date(start.getTime() + 60 * 60_000) }];
		const result = await submit(start.toISOString());
		expect(isActionFailure(result)).toBe(true);
		expect(ctx.calendar.busyCalls.length).toBeGreaterThan(0);
		expect(ctx.sent).toEqual([]);
	});
});

describe('/book/details action, Turnstile', () => {
	const siteverify = vi.fn();

	async function guestSubmit(token?: string): Promise<unknown> {
		const body = new FormData();
		body.set('lessonTypeId', LESSON_30);
		body.set('startsAt', slot(0));
		body.set('accountName', 'Gus Guest');
		body.set('email', 'gus@example.com');
		body.set('studentName', 'Gus');
		body.set('note', '');
		if (token !== undefined) body.set('cf-turnstile-response', token);
		const event = {
			locals: { account: null },
			getClientAddress: () => '9.9.9.9',
			request: new Request('http://localhost/book/details', { method: 'POST', body })
		};
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			return await (actions.default as any)(event);
		} catch (e) {
			return e;
		}
	}

	beforeEach(() => {
		ctx.store = new MemoryBookingStore();
		ctx.sent = [];
		ctx.calendar = fakeCalendar(false);
		siteverify.mockReset();
		vi.stubGlobal('fetch', siteverify);
		ctx.env.TURNSTILE_SITE_KEY = 'site';
		ctx.env.TURNSTILE_SECRET_KEY = 'secret';
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		ctx.env.TURNSTILE_SITE_KEY = undefined;
		ctx.env.TURNSTILE_SECRET_KEY = undefined;
	});

	it('rejects a guest submit with no token and creates no booking', async () => {
		const result = await guestSubmit();
		expect(isActionFailure(result)).toBe(true);
		const data = (result as { data: { errors: Record<string, string> } }).data;
		expect(data.errors).toEqual({ form: 'Please complete the spam check and try again.' });
		expect(siteverify).not.toHaveBeenCalled();
		expect(ctx.sent).toEqual([]);
	});

	it('rejects a guest submit when siteverify says no', async () => {
		siteverify.mockResolvedValue(new Response(JSON.stringify({ success: false })));
		const result = await guestSubmit('tok');
		expect(isActionFailure(result)).toBe(true);
		expect(ctx.sent).toEqual([]);
	});

	it('books when siteverify succeeds', async () => {
		siteverify.mockResolvedValue(new Response(JSON.stringify({ success: true })));
		const result = await guestSubmit('tok');
		expect(isRedirect(result)).toBe(true);
		expect(siteverify).toHaveBeenCalledTimes(1);
	});

	it('never calls siteverify for a signed-in submit', async () => {
		expect(isRedirect(await submit(slot(0)))).toBe(true);
		expect(siteverify).not.toHaveBeenCalled();
	});

	it('does no check when the site key is unset but the secret is set', async () => {
		ctx.env.TURNSTILE_SITE_KEY = undefined;
		const result = await guestSubmit();
		expect(isRedirect(result)).toBe(true);
		expect(siteverify).not.toHaveBeenCalled();
	});

	it('does no check when unconfigured', async () => {
		ctx.env.TURNSTILE_SECRET_KEY = undefined;
		const result = await guestSubmit();
		expect(isRedirect(result)).toBe(true);
		expect(siteverify).not.toHaveBeenCalled();
	});
});

describe('/book/details load, Turnstile site key', () => {
	async function run(account: Account | null) {
		const url = new URL(`http://localhost/book/details?type=${LESSON_30}&start=${slot(0)}`);
		if (account) url.searchParams.set('student', AVA);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (await (load as any)({ locals: { account }, url })) as { turnstileSiteKey?: string };
	}

	beforeEach(() => {
		ctx.store = new MemoryBookingStore();
		ctx.calendar = fakeCalendar(false);
	});
	afterEach(() => {
		ctx.env.TURNSTILE_SITE_KEY = undefined;
		ctx.env.TURNSTILE_SECRET_KEY = undefined;
	});

	it('exposes the site key to guests only when both keys are set', async () => {
		expect((await run(null)).turnstileSiteKey).toBeUndefined();
		ctx.env.TURNSTILE_SITE_KEY = 'site';
		expect((await run(null)).turnstileSiteKey).toBeUndefined();
		ctx.env.TURNSTILE_SECRET_KEY = 'secret';
		expect((await run(null)).turnstileSiteKey).toBe('site');
		expect((await run(pat)).turnstileSiteKey).toBeUndefined();
	});
});
