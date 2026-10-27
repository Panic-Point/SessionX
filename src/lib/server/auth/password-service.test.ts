import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryBookingStore } from '../store/memory';
import { demoData } from '../store/demo-data';
import type { EmailMessage, Mailer } from '../email/mailer';
import {
	changePassword,
	checkRegistrationLink,
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
const PARENT_PASSWORD = 'sessionx-parent-dev1';
const NEW_PASSWORD = 'a brand new passphrase 9!';
/** Like an account a guest booking created: no password yet. */
const GUEST = {
	id: '22222222-0000-0000-0000-0000000000c1',
	name: 'Gina Guest',
	email: 'gina@example.com',
	role: 'client' as const
};

function setup(failSend = false) {
	const data = demoData();
	data.accounts.push({ ...GUEST });
	const store = new MemoryBookingStore(data);
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
	it('normalizes a valid email', () => {
		expect(validateRegistration({ email: ' Robin@Example.com ' })).toEqual({
			ok: true,
			email: 'robin@example.com'
		});
	});

	it('reports a missing or malformed email', () => {
		expect(validateRegistration({ email: ' ' })).toEqual({
			ok: false,
			errors: { email: 'Enter your email address.' }
		});
		expect(validateRegistration({ email: 'nope' })).toEqual({
			ok: false,
			errors: { email: 'Enter a valid email address.' }
		});
	});
});

describe('registration', () => {
	const form = { name: ' Robin ', password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD };

	it('new email: no account until the password is set, then a client account with a student', async () => {
		const { deps, sent, store } = setup();
		await requestRegistration(deps, ' Robin@Example.com ', now);
		expect(await store.findAccountByEmail('robin@example.com')).toBeNull();
		expect(sent).toHaveLength(1);
		expect(sent[0].to).toBe('robin@example.com');
		expect(sent[0].subject).toBe('Finish creating your SessionX account');
		expect(sent[0].text).toMatch(/^Hi,/);

		const token = tokenFrom(sent[0], '/register/verify');
		const link = { email: 'robin@example.com', needsName: true };
		// Opening the link (even twice) doesn't use it.
		expect(await checkRegistrationLink(store, token, later(59))).toEqual(link);
		expect(await checkRegistrationLink(store, token, later(59))).toEqual(link);

		const r = await completeRegistration(store, token, form, later(60));
		expect(r.ok && r.account).toMatchObject({
			name: 'Robin',
			email: 'robin@example.com',
			role: 'client'
		});
		const id = r.ok ? r.account.id : '';
		expect((await store.listStudents(id)).map((s) => s.name)).toEqual(['Robin']);
		expect((await loginWithPassword(store, 'robin@example.com', NEW_PASSWORD, later(61))).ok).toBe(
			true
		);
		expect(await checkRegistrationLink(store, token, later(61))).toBeNull();
		expect(await completeRegistration(store, token, form, later(61))).toEqual({
			ok: false,
			invalid: true
		});
	});

	it('a new email needs a name; field errors leave the link usable', async () => {
		const { deps, sent, store } = setup();
		await requestRegistration(deps, 'robin@example.com', now);
		const token = tokenFrom(sent[0], '/register/verify');

		expect(
			await completeRegistration(
				store,
				token,
				{ name: ' ', password: 'Abc1!', confirmPassword: '' },
				now
			)
		).toEqual({
			ok: false,
			invalid: false,
			errors: { name: 'Enter your name.', password: 'Use at least 8 characters.' }
		});
		expect(
			await completeRegistration(store, token, { ...form, confirmPassword: 'other 1!' }, now)
		).toEqual({
			ok: false,
			invalid: false,
			errors: { confirmPassword: 'The passwords do not match.' }
		});
		expect(
			await completeRegistration(
				store,
				token,
				{ ...form, password: 'p030710p$e4o', confirmPassword: 'p030710p$e4o' },
				now
			)
		).toMatchObject({ ok: false, errors: { password: expect.stringMatching(/too common/) } });
		expect(await store.findAccountByEmail('robin@example.com')).toBeNull();
		expect((await completeRegistration(store, token, form, now)).ok).toBe(true);
	});

	it("existing email: nothing changes until the password is set; the family's data survives", async () => {
		const { deps, sent, store } = setup();
		const students = await store.listStudents(PARENT_ID);
		await requestRegistration(deps, 'parent@example.com', now);
		// The old password still works.
		expect((await loginWithPassword(store, 'parent@example.com', PARENT_PASSWORD, now)).ok).toBe(
			true
		);
		// The email greets the real account holder.
		expect(sent[0].text).toContain('Hi Pat Parent');

		const token = tokenFrom(sent[0], '/register/verify');
		expect(await checkRegistrationLink(store, token, now)).toEqual({
			email: 'parent@example.com',
			needsName: false
		});
		// No name field for an existing account, so none is required and any sent is ignored.
		const r = await completeRegistration(store, token, { ...form, name: '' }, now);
		expect(r).toEqual({
			ok: true,
			account: { id: PARENT_ID, name: 'Pat Parent', email: 'parent@example.com', role: 'client' }
		});
		expect(await store.listStudents(PARENT_ID)).toEqual(students);
		expect((await loginWithPassword(store, 'parent@example.com', NEW_PASSWORD, now)).ok).toBe(true);
		expect((await loginWithPassword(store, 'parent@example.com', PARENT_PASSWORD, now)).ok).toBe(
			false
		);
	});

	it('a guest-booking account keeps its name and students and gets no new student', async () => {
		const { deps, sent, store } = setup();
		await store.addStudent(GUEST.id, 'Gina Jr');
		await requestRegistration(deps, GUEST.email, now);
		const token = tokenFrom(sent[0], '/register/verify');
		const r = await completeRegistration(store, token, { ...form, name: 'Someone Else' }, now);
		expect(r).toEqual({ ok: true, account: GUEST });
		expect((await store.listStudents(GUEST.id)).map((s) => s.name)).toEqual(['Gina Jr']);
	});

	it('link is single use and expires after 24 hours', async () => {
		const { deps, sent, store } = setup();
		await requestRegistration(deps, 'a@example.com', now);
		await requestRegistration(deps, 'b@example.com', now);
		const a = tokenFrom(sent[0], '/register/verify');
		expect((await completeRegistration(store, a, form, now)).ok).toBe(true);
		expect(await completeRegistration(store, a, form, now)).toEqual({ ok: false, invalid: true });
		const b = tokenFrom(sent[1], '/register/verify');
		expect(await checkRegistrationLink(store, b, later(24 * 60))).toBeNull();
		expect(await completeRegistration(store, b, form, later(24 * 60))).toEqual({
			ok: false,
			invalid: true
		});
		expect(await completeRegistration(store, generateToken(), form, now)).toEqual({
			ok: false,
			invalid: true
		});
		expect(await completeRegistration(store, '', form, now)).toEqual({ ok: false, invalid: true });
	});

	it('mailer failure is logged not thrown', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { deps } = setup(true);
		await expect(requestRegistration(deps, 'a@example.com', now)).resolves.toBeUndefined();
		expect(spy).toHaveBeenCalled();
	});
});

describe('loginWithPassword', () => {
	it('signs in client and admin with the right password', async () => {
		const { store } = setup();
		const r = await loginWithPassword(store, ' PARENT@example.com ', PARENT_PASSWORD, now);
		expect(r).toEqual({ ok: true, account: expect.objectContaining({ id: PARENT_ID }) });

		const admin = await loginWithPassword(
			store,
			'admin@sessionx.local',
			'sessionx-admin-dev1',
			now
		);
		expect(admin.ok && admin.account.role).toBe('admin');
	});

	it('signs in with an older password that the current rules would reject', async () => {
		const { store } = setup();
		await store.setPasswordHash(PARENT_ID, await hashPassword('sessionx-parent-dev'));
		expect(
			(await loginWithPassword(store, 'parent@example.com', 'sessionx-parent-dev', now)).ok
		).toBe(true);
	});

	it('fails the same way for a wrong password, no password and an unknown email', async () => {
		const { store } = setup();
		const wrong = await loginWithPassword(store, 'parent@example.com', 'not the password', now);
		const none = await loginWithPassword(store, GUEST.email, 'not the password', now);
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

	it('lets an account without a password (e.g. from a guest booking) set its first one', async () => {
		const { deps, sent, store } = setup();
		await requestPasswordReset(deps, GUEST.email, now);
		const token = tokenFrom(sent[0], '/login/reset/complete');
		const r = await completePasswordReset(store, token, NEW_PASSWORD, NEW_PASSWORD, now);
		expect(r).toEqual({ ok: true, account: GUEST });
		expect((await loginWithPassword(store, GUEST.email, NEW_PASSWORD, now)).ok).toBe(true);
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
		expect(bad.ok === false && !bad.invalid && bad.errors.password).toMatch(/at least 8/);
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

describe('changePassword', () => {
	const parent = {
		id: PARENT_ID,
		name: 'Pat Parent',
		email: 'parent@example.com',
		role: 'client' as const
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
			GUEST,
			{ currentPassword: '', password: NEW_PASSWORD, confirmPassword: 'different value' },
			now
		);
		expect(bad).toEqual({ ok: false, errors: { confirmPassword: 'The passwords do not match.' } });
		const good = await changePassword(
			store,
			GUEST,
			{ currentPassword: '', password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
			now
		);
		expect(good).toEqual({ ok: true });
		expect((await loginWithPassword(store, GUEST.email, NEW_PASSWORD, now)).ok).toBe(true);
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
