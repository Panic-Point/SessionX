import { describe, it, expect, beforeEach } from 'vitest';
import { DEMO_ADMIN_PASSWORD_HASH, DEMO_PARENT_PASSWORD_HASH } from './demo-data';
import { AdminStoreError } from './types';
import type { AccountStore, AdminStore } from './types';

const NOW = new Date('2026-11-01T17:00:00Z');
const LATER = new Date(NOW.getTime() + 30 * 60_000);
const ADMIN_ID = '22222222-0000-0000-0000-00000000000a';
const PARENT_ID = '22222222-0000-0000-0000-00000000000b';
const MISSING_ID = '99999999-0000-0000-0000-000000000000';
const HASH_A = 'pbkdf2-sha256$100000$AAAA$aaaa';
const HASH_B = 'pbkdf2-sha256$100000$BBBB$bbbb';

let counter = 0;
/** Distinct per call so the suite can run against a store that keeps used tokens. */
function tokenHash(): string {
	counter += 1;
	return `contract-token-${Date.now()}-${counter}`;
}

/** Password behaviour every AdminStore implementation must share. Seeded with supabase/seed.sql. */
export function runPasswordStoreContract(
	name: string,
	makeStore: () => Promise<AdminStore & AccountStore>,
	reset?: () => Promise<void>
) {
	describe(`AdminStore password contract: ${name}`, () => {
		if (reset) beforeEach(reset);

		it('seed: parent and admin have their dev passwords', async () => {
			const store = await makeStore();
			expect(await store.getPasswordHash(PARENT_ID)).toBe(DEMO_PARENT_PASSWORD_HASH);
			expect(await store.getPasswordHash(ADMIN_ID)).toBe(DEMO_ADMIN_PASSWORD_HASH);
			expect(await store.getPasswordHash(MISSING_ID)).toBeNull();
		});

		it('setPasswordHash round-trips and rejects unknown accounts', async () => {
			const store = await makeStore();
			await store.setPasswordHash(ADMIN_ID, HASH_A);
			expect(await store.getPasswordHash(ADMIN_ID)).toBe(HASH_A);
			await expect(store.setPasswordHash(MISSING_ID, HASH_A)).rejects.toBeInstanceOf(
				AdminStoreError
			);
		});

		it('registration for a new email creates a client account only when used', async () => {
			const store = await makeStore();
			const t = tokenHash();
			await store.createPasswordToken(
				t,
				{
					purpose: 'register',
					email: ' New.Family@Example.com ',
					name: 'New Family',
					passwordHash: HASH_A
				},
				LATER
			);
			expect(await store.findAccountByEmail('new.family@example.com')).toBeNull();

			const id = await store.completeRegistration(t, NOW);
			expect(id).not.toBeNull();
			expect(await store.findAccountById(id!)).toEqual({
				id,
				name: 'New Family',
				email: 'new.family@example.com',
				role: 'client'
			});
			expect(await store.getPasswordHash(id!)).toBe(HASH_A);
			expect(await store.completeRegistration(t, NOW)).toBeNull();
		});

		it("registration for an existing email keeps the account's name, role and students", async () => {
			const store = await makeStore();
			const before = await store.listStudents(PARENT_ID);
			const t = tokenHash();
			await store.createPasswordToken(
				t,
				{
					purpose: 'register',
					email: 'PARENT@example.com',
					name: 'Impostor',
					passwordHash: HASH_B
				},
				LATER
			);
			expect(await store.getPasswordHash(PARENT_ID)).toBe(DEMO_PARENT_PASSWORD_HASH);

			expect(await store.completeRegistration(t, NOW)).toBe(PARENT_ID);
			expect(await store.findAccountById(PARENT_ID)).toMatchObject({
				name: 'Pat Parent',
				role: 'client'
			});
			expect(await store.getPasswordHash(PARENT_ID)).toBe(HASH_B);
			expect(await store.listStudents(PARENT_ID)).toEqual(before);

			const admin = tokenHash();
			await store.createPasswordToken(
				admin,
				{ purpose: 'register', email: 'admin@sessionx.local', name: 'X', passwordHash: HASH_A },
				LATER
			);
			expect(await store.completeRegistration(admin, NOW)).toBe(ADMIN_ID);
			expect((await store.findAccountById(ADMIN_ID))?.role).toBe('admin');
		});

		it('rejects expired tokens and tokens of the other purpose', async () => {
			const store = await makeStore();
			const reg = tokenHash();
			await store.createPasswordToken(
				reg,
				{ purpose: 'register', email: 'late@example.com', name: 'Late', passwordHash: HASH_A },
				NOW
			);
			expect(await store.completeRegistration(reg, NOW)).toBeNull();
			expect(await store.findAccountByEmail('late@example.com')).toBeNull();

			const rst = tokenHash();
			await store.createPasswordToken(rst, { purpose: 'reset', accountId: PARENT_ID }, LATER);
			expect(await store.completeRegistration(rst, NOW)).toBeNull();
			const reg2 = tokenHash();
			await store.createPasswordToken(
				reg2,
				{ purpose: 'register', email: 'x@example.com', name: 'X', passwordHash: HASH_A },
				LATER
			);
			expect(await store.completePasswordReset(reg2, HASH_B, NOW)).toBeNull();
			// Neither attempt used up the other token.
			expect(await store.completePasswordReset(rst, HASH_B, NOW)).toBe(PARENT_ID);
			expect(await store.completeRegistration(reg2, NOW)).not.toBeNull();
		});

		it('reset sets the password once and voids the other outstanding tokens', async () => {
			const store = await makeStore();
			const first = tokenHash();
			const second = tokenHash();
			const reg = tokenHash();
			await store.createPasswordToken(first, { purpose: 'reset', accountId: PARENT_ID }, LATER);
			await store.createPasswordToken(second, { purpose: 'reset', accountId: PARENT_ID }, LATER);
			await store.createPasswordToken(
				reg,
				{ purpose: 'register', email: 'parent@example.com', name: 'P', passwordHash: HASH_B },
				LATER
			);

			expect(await store.completePasswordReset(first, HASH_A, NOW)).toBe(PARENT_ID);
			expect(await store.getPasswordHash(PARENT_ID)).toBe(HASH_A);
			expect(await store.completePasswordReset(first, HASH_B, NOW)).toBeNull();
			expect(await store.completePasswordReset(second, HASH_B, NOW)).toBeNull();
			expect(await store.completeRegistration(reg, NOW)).toBeNull();
			expect(await store.getPasswordHash(PARENT_ID)).toBe(HASH_A);
		});

		it('counts failures per email case-insensitively after `since`, and clears them', async () => {
			const store = await makeStore();
			const at = (min: number) => new Date(NOW.getTime() + min * 60_000);
			await store.recordPasswordFailure('Someone@Example.com', at(0));
			await store.recordPasswordFailure('someone@example.com', at(5));
			await store.recordPasswordFailure('other@example.com', at(5));
			expect(await store.countPasswordFailures(' SOMEONE@example.com', at(-1))).toBe(2);
			expect(await store.countPasswordFailures('someone@example.com', at(0))).toBe(1);

			await store.clearPasswordFailures('someone@EXAMPLE.com');
			expect(await store.countPasswordFailures('someone@example.com', at(-1))).toBe(0);
			expect(await store.countPasswordFailures('other@example.com', at(-1))).toBe(1);
		});

		it('using a reset link clears the lockout for that email', async () => {
			const store = await makeStore();
			await store.recordPasswordFailure('parent@example.com', NOW);
			const t = tokenHash();
			await store.createPasswordToken(t, { purpose: 'reset', accountId: PARENT_ID }, LATER);
			await store.completePasswordReset(t, HASH_A, NOW);
			expect(await store.countPasswordFailures('parent@example.com', new Date(0))).toBe(0);
		});
	});
}
