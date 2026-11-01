import { isActionFailure, isRedirect } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessage } from '#lib/server/email/mailer.ts';
import { demoData } from '#lib/server/store/demo-data.ts';
import { MemoryBookingStore } from '#lib/server/store/memory.ts';

const ctx = vi.hoisted(() => ({
	store: undefined as unknown as MemoryBookingStore,
	sent: [] as EmailMessage[],
	background: [] as Promise<unknown>[],
	env: { TURNSTILE_SITE_KEY: undefined, TURNSTILE_SECRET_KEY: undefined } as {
		TURNSTILE_SITE_KEY: string | undefined;
		TURNSTILE_SECRET_KEY: string | undefined;
	}
}));
vi.mock('#lib/server/background.ts', () => ({
	runInBackground: (task: Promise<unknown>) => void ctx.background.push(task)
}));
vi.mock('$app/env', () => ({ dev: true }));
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
	getSessionSecret: () => 'test-secret'
}));

const login = await import('./+page.server');
const reset = await import('./reset/+page.server');
const resetComplete = await import('./reset/complete/+page.server');
const register = await import('../register/+page.server');
const registerVerify = await import('../register/verify/+page.server');

function cookieJar() {
	const set = new Map<string, string>();
	return { set, cookies: { set: (name: string, value: string) => void set.set(name, value) } };
}

async function post(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	action: (event: any) => unknown,
	fields: Record<string, string>
): Promise<{ result: unknown; cookies: Map<string, string> }> {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	const jar = cookieJar();
	const event = {
		request: new Request('http://localhost/x', { method: 'POST', body }),
		cookies: jar.cookies,
		getClientAddress: () => '127.0.0.1',
		locals: { account: null }
	};
	try {
		return { result: await action(event), cookies: jar.set };
	} catch (e) {
		return { result: e, cookies: jar.set };
	}
}

/** Waits for the background email that carries a `path` link, and returns its token. */
async function emailedToken(to: string, path: string): Promise<string> {
	const re = new RegExp(`${path}\\?token=([A-Za-z0-9_-]+)`);
	return vi.waitFor(() => {
		const m = ctx.sent.find((e) => e.to === to && re.test(e.text));
		expect(m).toBeDefined();
		return re.exec(m!.text)![1];
	});
}

beforeEach(() => {
	const data = demoData();
	// Like an account a guest booking created: no password yet.
	data.accounts.push({
		id: '22222222-0000-0000-0000-0000000000c1',
		name: 'Gina Guest',
		email: 'gina@example.com',
		role: 'client'
	});
	ctx.store = new MemoryBookingStore(data);
	ctx.sent = [];
});

// Let each test's background emails finish before the next test swaps the store.
afterEach(async () => {
	await Promise.all(ctx.background.splice(0));
});

describe('password sign-in action', () => {
	it('signs the admin in on /admin', async () => {
		const { result, cookies } = await post(login.actions.default, {
			email: 'admin@sessionx.local',
			password: 'sessionx-admin-dev1'
		});
		expect(result).toMatchObject({ status: 303, location: '/admin' });
		expect(cookies.get('sx_session')).toBeTruthy();
	});

	it('signs in with the right password and lands on /account', async () => {
		const { result, cookies } = await post(login.actions.default, {
			email: 'parent@example.com',
			password: 'sessionx-parent-dev1'
		});
		expect(isRedirect(result)).toBe(true);
		expect(result).toMatchObject({ status: 303, location: '/account' });
		expect(cookies.get('sx_session')).toBeTruthy();
	});

	it('counts family sign-ins and failed attempts on the Usage tab, but not the admin', async () => {
		const usage = async () =>
			(await ctx.store.listUsageEvents(new Date(0), new Date(Date.now() + 1000), 100)).events;
		await post(login.actions.default, {
			email: 'admin@sessionx.local',
			password: 'sessionx-admin-dev1'
		});
		expect(await usage()).toEqual([]);
		await post(login.actions.default, {
			email: 'parent@example.com',
			password: 'sessionx-parent-dev1'
		});
		await post(login.actions.default, { email: 'parent@example.com', password: 'nope' });
		const events = await usage();
		expect(events.map((e) => [e.kind, e.accountId])).toEqual([
			['sign_in', '22222222-0000-0000-0000-00000000000b'],
			['sign_in_failed', null]
		]);
		// The email someone typed is never kept.
		expect(JSON.stringify(events)).not.toContain('parent@example.com');
	});

	it('still signs in when recording the sign-in fails, and logs it', async () => {
		vi.spyOn(ctx.store, 'recordUsageEvent').mockRejectedValue(new Error('db down'));
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { result } = await post(login.actions.default, {
			email: 'parent@example.com',
			password: 'sessionx-parent-dev1'
		});
		expect(result).toMatchObject({ status: 303, location: '/account' });
		expect(errors).toHaveBeenCalledWith('usage: failed to record sign_in event', expect.any(Error));
		errors.mockRestore();
	});

	it('answers wrong password, no password and unknown email identically', async () => {
		const answers = [];
		for (const email of ['parent@example.com', 'gina@example.com', 'nobody@example.com']) {
			const { result, cookies } = await post(login.actions.default, {
				email,
				password: 'not the password'
			});
			expect(isActionFailure(result)).toBe(true);
			expect(cookies.size).toBe(0);
			answers.push({ ...(result as { data: Record<string, unknown> }).data, email: undefined });
		}
		expect(answers[0]).toMatchObject({ error: 'Email or password is incorrect.', locked: false });
		expect(answers[1]).toEqual(answers[0]);
		expect(answers[2]).toEqual(answers[0]);
	});

	it('refuses the 6th attempt even with the right password', async () => {
		for (let i = 0; i < 5; i++) {
			await post(login.actions.default, { email: 'parent@example.com', password: 'wrong guess' });
		}
		const { result, cookies } = await post(login.actions.default, {
			email: 'parent@example.com',
			password: 'sessionx-parent-dev1'
		});
		expect(isActionFailure(result)).toBe(true);
		expect(result).toMatchObject({
			data: { error: 'Email or password is incorrect.', locked: true }
		});
		expect(cookies.size).toBe(0);
	});

	it('asks for missing fields', async () => {
		const { result } = await post(login.actions.default, { email: '', password: '' });
		expect(result).toMatchObject({
			status: 400,
			data: { errors: { email: 'Enter your email address.', password: 'Enter your password.' } }
		});
	});
});

describe('registration actions', () => {
	const NEW_PASSWORD = 'a brand new passphrase 9!';
	const setPassword = { name: 'Robin', password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD };

	const openLink = async (token: string) =>
		registerVerify.load({ url: new URL(`https://x/register/verify?token=${token}`) } as never);

	it('asks only for an email and answers the same for new and existing emails', async () => {
		const known = await post(register.actions.default, { email: 'parent@example.com' });
		const unknown = await post(register.actions.default, { email: 'robin@example.com' });
		expect(known.result).toEqual({ sent: true });
		expect(unknown.result).toEqual(known.result);
		expect(known.cookies.size + unknown.cookies.size).toBe(0);
		expect(await ctx.store.findAccountByEmail('robin@example.com')).toBeNull();
		expect(await ctx.store.findAccountByEmail('parent@example.com')).toMatchObject({
			name: 'Pat Parent'
		});
		await emailedToken('parent@example.com', '/register/verify');
		await emailedToken('robin@example.com', '/register/verify');
	});

	it('the link opens a set-password form; saving signs the new family in on /account', async () => {
		await post(register.actions.default, { email: 'robin@example.com' });
		const token = await emailedToken('robin@example.com', '/register/verify');

		const page = { token, valid: true, email: 'robin@example.com', needsName: true };
		expect(await openLink(token)).toEqual(page);
		// Opening it again (a link scanner, or the person) still works.
		expect(await openLink(token)).toEqual(page);

		const { result, cookies } = await post(registerVerify.actions.default, {
			token,
			...setPassword
		});
		expect(result).toMatchObject({ status: 303, location: '/account' });
		expect(cookies.get('sx_session')).toBeTruthy();

		expect(await openLink(token)).toMatchObject({ valid: false });
		const again = await post(registerVerify.actions.default, { token, ...setPassword });
		expect(again.result).toMatchObject({ status: 400, data: { invalid: true } });
	});

	it('an invalid password shows field errors and leaves the link usable', async () => {
		await post(register.actions.default, { email: 'robin@example.com' });
		const token = await emailedToken('robin@example.com', '/register/verify');
		const { result, cookies } = await post(registerVerify.actions.default, {
			token,
			name: 'Robin',
			password: 'Abcdefg1',
			confirmPassword: 'Abcdefg1'
		});
		expect(result).toMatchObject({
			status: 400,
			data: {
				invalid: false,
				values: { name: 'Robin' },
				errors: { password: 'Include at least one special character, like ! or #.' }
			}
		});
		expect(JSON.stringify(result)).not.toContain('Abcdefg1');
		expect(cookies.size).toBe(0);
		expect(await openLink(token)).toMatchObject({ valid: true });
		const retry = await post(registerVerify.actions.default, { token, ...setPassword });
		expect(retry.result).toMatchObject({ status: 303, location: '/account' });
	});

	it('an existing family is not asked for a name and keeps theirs', async () => {
		await post(register.actions.default, { email: 'parent@example.com' });
		const token = await emailedToken('parent@example.com', '/register/verify');
		expect(await openLink(token)).toMatchObject({ valid: true, needsName: false });
		const { result } = await post(registerVerify.actions.default, {
			token,
			password: NEW_PASSWORD,
			confirmPassword: NEW_PASSWORD
		});
		expect(result).toMatchObject({ status: 303, location: '/account' });
		expect(await ctx.store.findAccountByEmail('parent@example.com')).toMatchObject({
			name: 'Pat Parent'
		});
	});

	it('the admin lands on /admin', async () => {
		await post(register.actions.default, { email: 'admin@sessionx.local' });
		const token = await emailedToken('admin@sessionx.local', '/register/verify');
		const { result } = await post(registerVerify.actions.default, {
			token,
			password: NEW_PASSWORD,
			confirmPassword: NEW_PASSWORD
		});
		expect(result).toMatchObject({ status: 303, location: '/admin' });
	});

	it('an unknown or missing token shows the expired page', async () => {
		expect(await openLink('nope')).toEqual({
			token: '',
			valid: false,
			email: '',
			needsName: false
		});
		expect(await openLink('')).toMatchObject({ valid: false });
	});

	it('fills in the email from the guest invite link', async () => {
		const loaded = await register.load({
			locals: { account: null },
			url: new URL('https://x/register?email=gina%40example.com')
		} as never);
		expect(loaded).toMatchObject({ email: 'gina@example.com' });
	});

	it('shows an email error without sending anything', async () => {
		const { result } = await post(register.actions.default, { email: 'not an email' });
		expect(result).toMatchObject({
			status: 400,
			data: {
				values: { email: 'not an email' },
				errors: { email: 'Enter a valid email address.' }
			}
		});
		expect(ctx.background).toHaveLength(0);
	});
});

describe('password reset actions', () => {
	it('answers the same for known and unknown emails', async () => {
		const known = await post(reset.actions.default, { email: 'parent@example.com' });
		const unknown = await post(reset.actions.default, { email: 'nobody@example.com' });
		expect(known.result).toEqual({ sent: true });
		expect(unknown.result).toEqual(known.result);
	});

	it('sends one email per account however often the form is posted', async () => {
		const posts = Array.from({ length: 10 }, () =>
			post(reset.actions.default, { email: 'parent@example.com' })
		);
		for (const { result } of await Promise.all(posts)) expect(result).toEqual({ sent: true });
		await Promise.all(ctx.background.splice(0));
		expect(ctx.sent.filter((m) => m.to === 'parent@example.com')).toHaveLength(1);
	});

	it('needs the spam check when Turnstile is configured, and passes the site key', async () => {
		ctx.env.TURNSTILE_SITE_KEY = 'site';
		ctx.env.TURNSTILE_SECRET_KEY = 'secret';
		const siteverify = vi.fn(async () => Response.json({ success: false }));
		vi.stubGlobal('fetch', siteverify);
		try {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			expect(await (reset.load as any)({})).toEqual({ turnstileSiteKey: 'site' });
			const { result } = await post(reset.actions.default, { email: 'parent@example.com' });
			expect(isActionFailure(result)).toBe(true);
			expect((result as { data: { error: string } }).data.error).toBe(
				'Please complete the spam check and try again.'
			);
			expect(ctx.background).toHaveLength(0);
		} finally {
			vi.unstubAllGlobals();
			ctx.env.TURNSTILE_SITE_KEY = undefined;
			ctx.env.TURNSTILE_SECRET_KEY = undefined;
		}
	});

	it('reset link sets the new password and signs in', async () => {
		await post(reset.actions.default, { email: 'parent@example.com' });
		const token = await emailedToken('parent@example.com', '/login/reset/complete');
		const { result, cookies } = await post(resetComplete.actions.default, {
			token,
			password: 'a brand new passphrase 9!',
			confirmPassword: 'a brand new passphrase 9!'
		});
		expect(result).toMatchObject({ status: 303, location: '/account' });
		expect(cookies.get('sx_session')).toBeTruthy();

		const old = await post(login.actions.default, {
			email: 'parent@example.com',
			password: 'sessionx-parent-dev1'
		});
		expect(isActionFailure(old.result)).toBe(true);
	});
});
