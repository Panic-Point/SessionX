import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryBookingStore } from '../store/memory';
import { demoData } from '../store/demo-data';
import type { EmailMessage, Mailer } from '../email/mailer';
import { completeLogin, requestLoginLink } from './login-service';
import {
	changePassword,
	completePasswordReset,
	completeRegistration,
	loginWithPassword,
	requestPasswordReset,
	requestRegistration,
	validateRegistration
} from './password-service';
import { hashPassword } from './password';
import { generateToken } from './tokens';

const now = new Date('2026-11-01T00:00:00Z');
const later = (min: number) => new Date(now.getTime() + min * 60_000);
const PARENT_ID = '22222222-0000-0000-0000-00000000000b';
const PARENT_PASSWORD = 'sessionx-parent-dev';
const NEW_PASSWORD = 'a brand new passphrase';

function setup(failSend = false) {
	const store = new MemoryBookingStore(demoData());
	const sent: EmailMessage[] = [];
	const mailer: Mailer = {
		send: async (m) => {
			if (failSend) throw new Error('boom');
			sent.push(m);
		}
	};
	return { store, sent, deps: { store, mailer, appUrl: 'https://x.test/' } };
}

function tokenFrom(m: EmailMessage, path: string): string {
	const match = new RegExp(`https://x\\.test${path}\\?token=([A-Za-z0-9_-]+)`).exec(m.text);
	return match![1];
}

afterEach(() => vi.restoreAllMocks());

describe('validateRegistration', () => {
	const form = {
		name: ' Robin ',
		email: ' Robin@Example.com ',
		password: NEW_PASSWORD,
		confirmPassword: NEW_PASSWORD
	};

	it('normalizes valid input', () => {
		expect(validateRegistration(form)).toEqual({
			ok: true,
			name: 'Robin',
			email: 'robin@example.com'
		});
	});

	it('reports each field', () => {
		const r = validateRegistration({
			name: ' ',
			email: 'nope',
			password: 'short',
			confirmPassword: ''
		});
		expect(r.ok).toBe(false);
		if (r.ok) return;
		expect(Object.keys(r.errors).sort()).toEqual(['email', 'name', 'password']);
	});

	it('reports a mismatched confirmation and common passwords', () => {
		const mismatch = validateRegistration({ ...form, confirmPassword: 'something else entirely' });
		expect(mismatch).toEqual({
			ok: false,
			errors: { confirmPassword: 'The passwords do not match.' }
		});
		const common = validateRegistration({
			...form,
			password: 'qwertyuiop',
			confirmPassword: 'qwertyuiop'
		});
		expect(common.ok || common.errors.password).toMatch(/too common/);
	});
});

describe('registration', () => {
	it('new email: no account until the link is used, then a signed-in client account', async () => {
		const { deps, sent, store } = setup();
		await requestRegistration(
			deps,
			{ name: 'Robin', email: ' Robin@Example.com ', password: NEW_PASSWORD },
			now
		);
		expect(await store.findAccountByEmail('robin@example.com')).toBeNull();
		expect(sent).toHaveLength(1);
		expect(sent[0].to).toBe('robin@example.com');
		expect(sent[0].text).toContain('Hi Robin');

		const account = await completeRegistration(
			store,
			tokenFrom(sent[0], '/register/verify'),
			later(60)
		);
		expect(account).toMatchObject({ name: 'Robin', email: 'robin@example.com', role: 'client' });
		expect((await loginWithPassword(store, 'robin@example.com', NEW_PASSWORD, later(61))).ok).toBe(
			true
		);
	});

	it("existing email: nothing changes until the link is used; the family's data survives", async () => {
		const { deps, sent, store } = setup();
		const students = await store.listStudents(PARENT_ID);
		await requestRegistration(
			deps,
			{ name: 'Someone Else', email: 'parent@example.com', password: NEW_PASSWORD },
			now
		);
		// Old password still works, new one doesn't yet.
		expect((await loginWithPassword(store, 'parent@example.com', NEW_PASSWORD, now)).ok).toBe(
			false
		);
		expect((await loginWithPassword(store, 'parent@example.com', PARENT_PASSWORD, now)).ok).toBe(
			true
		);
		// The email greets the real account holder, not the submitted name.
		expect(sent[0].text).toContain('Hi Pat Parent');

		const account = await completeRegistration(store, tokenFrom(sent[0], '/register/verify'), now);
		expect(account).toEqual({
			id: PARENT_ID,
			name: 'Pat Parent',
			email: 'parent@example.com',
			role: 'client'
		});
		expect(await store.listStudents(PARENT_ID)).toEqual(students);
		expect((await loginWithPassword(store, 'parent@example.com', NEW_PASSWORD, now)).ok).toBe(true);
		expect((await loginWithPassword(store, 'parent@example.com', PARENT_PASSWORD, now)).ok).toBe(
			false
		);
	});

	it('link is single use and expires after 24 hours', async () => {
		const { deps, sent, store } = setup();
		await requestRegistration(
			deps,
			{ name: 'A', email: 'a@example.com', password: NEW_PASSWORD },
			now
		);
		await requestRegistration(
			deps,
			{ name: 'B', email: 'b@example.com', password: NEW_PASSWORD },
			now
		);
		const a = tokenFrom(sent[0], '/register/verify');
		expect(await completeRegistration(store, a, now)).not.toBeNull();
		expect(await completeRegistration(store, a, now)).toBeNull();
		const b = tokenFrom(sent[1], '/register/verify');
		expect(await completeRegistration(store, b, later(24 * 60))).toBeNull();
		expect(await completeRegistration(store, generateToken(), now)).toBeNull();
	});

	it('mailer failure is logged not thrown', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { deps } = setup(true);
		await expect(
			requestRegistration(deps, { name: 'A', email: 'a@example.com', password: NEW_PASSWORD }, now)
		).resolves.toBeUndefined();
		expect(spy).toHaveBeenCalled();
	});
});

describe('loginWithPassword', () => {
	it('signs in client and admin with the right password', async () => {
		const { store } = setup();
		const r = await loginWithPassword(store, ' PARENT@example.com ', PARENT_PASSWORD, now);
		expect(r).toEqual({ ok: true, account: expect.objectContaining({ id: PARENT_ID }) });

		const adminId = '22222222-0000-0000-0000-00000000000a';
		await store.setPasswordHash(adminId, await hashPassword(NEW_PASSWORD));
		const admin = await loginWithPassword(store, 'admin@sessionx.local', NEW_PASSWORD, now);
		expect(admin.ok && admin.account.role).toBe('admin');
	});

	it('fails the same way for a wrong password, no password and an unknown email', async () => {
		const { store } = setup();
		const wrong = await loginWithPassword(store, 'parent@example.com', 'not the password', now);
		const none = await loginWithPassword(store, 'admin@sessionx.local', 'not the password', now);
		const unknown = await loginWithPassword(store, 'nobody@example.com', 'not the password', now);
		expect(wrong).toEqual({ ok: false, locked: false });
		expect(none).toEqual(wrong);
		expect(unknown).toEqual(wrong);
	});

	it('locks after 5 failures in 15 minutes, even with the right password, then unlocks', async () => {
		const { store } = setup();
		for (let i = 0; i < 4; i++) {
			expect(
				await loginWithPassword(store, 'parent@example.com', 'wrong guess!', later(i))
			).toEqual({ ok: false, locked: false });
		}
		expect(await loginWithPassword(store, 'parent@example.com', 'wrong guess!', later(4))).toEqual({
			ok: false,
			locked: true
		});
		expect(await loginWithPassword(store, 'parent@example.com', PARENT_PASSWORD, later(5))).toEqual(
			{ ok: false, locked: true }
		);
		// The first failure (minute 0) leaves the window at minute 15.
		expect(
			(await loginWithPassword(store, 'parent@example.com', PARENT_PASSWORD, later(15))).ok
		).toBe(true);
	});

	it('locks unknown emails the same way', async () => {
		const { store } = setup();
		for (let i = 0; i < 5; i++)
			await loginWithPassword(store, 'nobody@example.com', 'guess guess', now);
		expect(await loginWithPassword(store, 'nobody@example.com', 'guess guess', now)).toEqual({
			ok: false,
			locked: true
		});
	});

	it('a successful sign-in clears earlier failures', async () => {
		const { store } = setup();
		for (let i = 0; i < 4; i++)
			await loginWithPassword(store, 'parent@example.com', 'nope nope', now);
		expect((await loginWithPassword(store, 'parent@example.com', PARENT_PASSWORD, now)).ok).toBe(
			true
		);
		expect(await loginWithPassword(store, 'parent@example.com', 'nope nope', now)).toEqual({
			ok: false,
			locked: false
		});
	});
});

describe('password reset', () => {
	it('emails a 30-minute single-use link; the reset signs in, replaces the password and unlocks', async () => {
		const { deps, sent, store } = setup();
		for (let i = 0; i < 5; i++)
			await loginWithPassword(store, 'parent@example.com', 'nope nope', now);
		await requestPasswordReset(deps, ' Parent@Example.com ', now);
		expect(sent).toHaveLength(1);
		expect(sent[0].to).toBe('parent@example.com');
		const token = tokenFrom(sent[0], '/login/reset/complete');

		const r = await completePasswordReset(store, token, NEW_PASSWORD, NEW_PASSWORD, later(29));
		expect(r).toEqual({ ok: true, account: expect.objectContaining({ id: PARENT_ID }) });
		expect(
			(await loginWithPassword(store, 'parent@example.com', PARENT_PASSWORD, later(29))).ok
		).toBe(false);
		expect((await loginWithPassword(store, 'parent@example.com', NEW_PASSWORD, later(29))).ok).toBe(
			true
		);
		expect(
			await completePasswordReset(store, token, NEW_PASSWORD, NEW_PASSWORD, later(29))
		).toEqual({
			ok: false,
			invalid: true
		});
	});

	it('expires after 30 minutes', async () => {
		const { deps, sent, store } = setup();
		await requestPasswordReset(deps, 'parent@example.com', now);
		const token = tokenFrom(sent[0], '/login/reset/complete');
		expect(
			await completePasswordReset(store, token, NEW_PASSWORD, NEW_PASSWORD, later(30))
		).toEqual({
			ok: false,
			invalid: true
		});
	});

	it('a rejected password keeps the link usable', async () => {
		const { deps, sent, store } = setup();
		await requestPasswordReset(deps, 'parent@example.com', now);
		const token = tokenFrom(sent[0], '/login/reset/complete');
		const bad = await completePasswordReset(store, token, 'short', 'short', now);
		expect(bad.ok === false && !bad.invalid && bad.errors.password).toMatch(/at least 10/);
		expect((await completePasswordReset(store, token, NEW_PASSWORD, NEW_PASSWORD, now)).ok).toBe(
			true
		);
	});

	it('does nothing for unknown email; logs mailer failures', async () => {
		const { deps, sent } = setup();
		await requestPasswordReset(deps, 'nobody@example.com', now);
		expect(sent).toHaveLength(0);
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const failing = setup(true);
		await expect(
			requestPasswordReset(failing.deps, 'parent@example.com', now)
		).resolves.toBeUndefined();
		expect(spy).toHaveBeenCalled();
	});
});

describe('magic links', () => {
	it('still sign in, and do not change the password', async () => {
		const { deps, sent, store } = setup();
		await requestLoginLink(deps, 'parent@example.com', now);
		const token = /\/login\/verify\?token=([A-Za-z0-9_-]+)/.exec(sent[0].text)![1];
		expect((await completeLogin(store, token, now))?.id).toBe(PARENT_ID);
		expect((await loginWithPassword(store, 'parent@example.com', PARENT_PASSWORD, now)).ok).toBe(
			true
		);
	});
});

describe('changePassword', () => {
	const parent = {
		id: PARENT_ID,
		name: 'Pat Parent',
		email: 'parent@example.com',
		role: 'client' as const
	};
	const admin = {
		id: '22222222-0000-0000-0000-00000000000a',
		name: 'Studio Admin',
		email: 'admin@sessionx.local',
		role: 'admin' as const
	};

	it('requires the current password when one exists', async () => {
		const { store } = setup();
		const form = { currentPassword: '', password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD };
		expect(await changePassword(store, parent, form, now)).toEqual({
			ok: false,
			errors: { currentPassword: 'Enter your current password.' }
		});
		expect(
			await changePassword(store, parent, { ...form, currentPassword: 'wrong wrong' }, now)
		).toEqual({ ok: false, errors: { currentPassword: 'Current password is incorrect.' } });
		expect(
			await changePassword(store, parent, { ...form, currentPassword: PARENT_PASSWORD }, now)
		).toEqual({ ok: true });
		expect((await loginWithPassword(store, 'parent@example.com', NEW_PASSWORD, now)).ok).toBe(true);
	});

	it('sets a first password without a current one, and validates the new one', async () => {
		const { store } = setup();
		const bad = await changePassword(
			store,
			admin,
			{ currentPassword: '', password: NEW_PASSWORD, confirmPassword: 'different value' },
			now
		);
		expect(bad).toEqual({ ok: false, errors: { confirmPassword: 'The passwords do not match.' } });
		const good = await changePassword(
			store,
			admin,
			{ currentPassword: '', password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
			now
		);
		expect(good).toEqual({ ok: true });
		expect((await loginWithPassword(store, 'admin@sessionx.local', NEW_PASSWORD, now)).ok).toBe(
			true
		);
	});

	it('wrong current passwords share the sign-in lockout', async () => {
		const { store } = setup();
		const form = {
			currentPassword: 'wrong wrong',
			password: NEW_PASSWORD,
			confirmPassword: NEW_PASSWORD
		};
		for (let i = 0; i < 5; i++) await changePassword(store, parent, form, now);
		const r = await changePassword(
			store,
			parent,
			{ ...form, currentPassword: PARENT_PASSWORD },
			now
		);
		expect(r.ok === false && r.errors.currentPassword).toMatch(/Too many incorrect attempts/);
	});
});
