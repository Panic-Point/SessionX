import type { Account, AdminStore } from '../store/types';
import type { Mailer } from '../email/mailer';
import { passwordResetEmail, verifyRegistrationEmail } from '../email/templates';
import { hashPassword, passwordProblem, verifyPassword, verifyPasswordOrDummy } from './password';
import { generateToken, hashToken } from './tokens';

export interface PasswordDeps {
	store: AdminStore;
	mailer: Mailer;
	appUrl: string;
}

export const LOCKOUT_ATTEMPTS = 5;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
const REGISTRATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const NAME_MAX = 100;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type FieldErrors = Partial<Record<string, string>>;

const normalize = (email: string) => email.trim().toLowerCase();

function linkUrl(appUrl: string, path: string, token: string): string {
	return `${appUrl.replace(/\/+$/, '')}${path}?token=${token}`;
}

/** Errors for a new password and its confirmation, keyed `password` / `confirmPassword`. */
function newPasswordErrors(password: string, confirmPassword: string): FieldErrors {
	const errors: FieldErrors = {};
	const problem = passwordProblem(password);
	if (problem) errors.password = problem;
	else if (password !== confirmPassword) errors.confirmPassword = 'The passwords do not match.';
	return errors;
}

/** Checks only the submitted email, never the store, so the result can't reveal accounts. */
export function validateRegistration(form: {
	email: string;
}): { ok: true; email: string } | { ok: false; errors: FieldErrors } {
	const email = normalize(form.email);
	if (!email) return { ok: false, errors: { email: 'Enter your email address.' } };
	if (!EMAIL_RE.test(email))
		return { ok: false, errors: { email: 'Enter a valid email address.' } };
	return { ok: true, email };
}

/**
 * Emails a link to finish creating the account; the password is chosen on the page it opens.
 * Nothing about an existing account changes until the link is used. Run it in the background so
 * the response is the same either way.
 */
export async function requestRegistration(
	deps: PasswordDeps,
	email: string,
	now: Date
): Promise<void> {
	const normalized = normalize(email);
	const token = generateToken();
	await deps.store.createPasswordToken(
		await hashToken(token),
		{ purpose: 'register', email: normalized },
		new Date(now.getTime() + REGISTRATION_TOKEN_TTL_MS)
	);
	// The email only goes to the address itself, so greeting an existing family by name is fine.
	const existing = await deps.store.findAccountByEmail(normalized);
	const url = linkUrl(deps.appUrl, '/register/verify', token);
	try {
		await deps.mailer.send(verifyRegistrationEmail(normalized, existing?.name ?? null, url));
	} catch (err) {
		console.error('Failed to send registration email', err);
	}
}

export interface RegistrationLink {
	email: string;
	/** True when the email has no account yet, so the page asks for a name. */
	needsName: boolean;
}

/** Looks the link up without using it, so link scanners that open the URL can't spend it. */
export async function checkRegistrationLink(
	store: AdminStore,
	token: string,
	now: Date
): Promise<RegistrationLink | null> {
	if (!token) return null;
	const data = await store.peekPasswordToken(await hashToken(token), 'register', now);
	if (data?.purpose !== 'register') return null;
	return { email: data.email, needsName: !(await store.findAccountByEmail(data.email)) };
}

export interface SetPasswordForm {
	name: string;
	password: string;
	confirmPassword: string;
}

export type RegistrationResult =
	| { ok: true; account: Account }
	| { ok: false; invalid: true }
	| { ok: false; invalid: false; errors: FieldErrors };

/**
 * Validates first, so a rejected form doesn't use up the link. A new account is named from the
 * form and gets that name as its first student; an existing account keeps its name.
 */
export async function completeRegistration(
	store: AdminStore,
	token: string,
	form: SetPasswordForm,
	now: Date
): Promise<RegistrationResult> {
	const link = await checkRegistrationLink(store, token, now);
	if (!link) return { ok: false, invalid: true };
	const errors: FieldErrors = {};
	const name = form.name.trim();
	if (link.needsName) {
		if (!name) errors.name = 'Enter your name.';
		else if (name.length > NAME_MAX) errors.name = `Use at most ${NAME_MAX} characters.`;
	}
	Object.assign(errors, newPasswordErrors(form.password, form.confirmPassword));
	if (Object.keys(errors).length) return { ok: false, invalid: false, errors };

	const accountId = await store.completeRegistration(
		await hashToken(token),
		{ name: link.needsName ? name : '', passwordHash: await hashPassword(form.password) },
		now
	);
	const account = accountId ? await store.findAccountById(accountId) : null;
	return account ? { ok: true, account } : { ok: false, invalid: true };
}

export type PasswordLoginResult = { ok: true; account: Account } | { ok: false; locked: boolean };

/**
 * Unknown email, no password and wrong password all fail the same way, after the same hash work.
 * Failures count per email, so a lockout looks the same for an address with no account.
 */
export async function loginWithPassword(
	store: AdminStore,
	email: string,
	password: string,
	now: Date
): Promise<PasswordLoginResult> {
	const normalized = normalize(email);
	const failures = await store.countPasswordFailures(
		normalized,
		new Date(now.getTime() - LOCKOUT_WINDOW_MS)
	);
	const account = await store.findAccountByEmail(normalized);
	const stored = account ? await store.getPasswordHash(account.id) : null;
	const matches = await verifyPasswordOrDummy(password, stored);

	if (failures >= LOCKOUT_ATTEMPTS) return { ok: false, locked: true };
	if (!account || !matches) {
		await store.recordPasswordFailure(normalized, now);
		return { ok: false, locked: failures + 1 >= LOCKOUT_ATTEMPTS };
	}
	await store.clearPasswordFailures(normalized);
	return { ok: true, account };
}

/** Silent no-op for unknown emails so callers cannot enumerate accounts. */
export async function requestPasswordReset(
	deps: PasswordDeps,
	email: string,
	now: Date
): Promise<void> {
	const account = await deps.store.findAccountByEmail(normalize(email));
	if (!account) return;
	const token = generateToken();
	await deps.store.createPasswordToken(
		await hashToken(token),
		{ purpose: 'reset', accountId: account.id },
		new Date(now.getTime() + RESET_TOKEN_TTL_MS)
	);
	const url = linkUrl(deps.appUrl, '/login/reset/complete', token);
	try {
		await deps.mailer.send(passwordResetEmail(account.email, account.name, url));
	} catch (err) {
		console.error('Failed to send password reset email', err);
	}
}

export type ResetResult =
	| { ok: true; account: Account }
	| { ok: false; invalid: true }
	| { ok: false; invalid: false; errors: FieldErrors };

/** Validates first, so a rejected password doesn't use up the link. Clears the lockout. */
export async function completePasswordReset(
	store: AdminStore,
	token: string,
	password: string,
	confirmPassword: string,
	now: Date
): Promise<ResetResult> {
	if (!token) return { ok: false, invalid: true };
	const errors = newPasswordErrors(password, confirmPassword);
	if (Object.keys(errors).length) return { ok: false, invalid: false, errors };
	const accountId = await store.completePasswordReset(
		await hashToken(token),
		await hashPassword(password),
		now
	);
	const account = accountId ? await store.findAccountById(accountId) : null;
	return account ? { ok: true, account } : { ok: false, invalid: true };
}

export interface ChangePasswordForm {
	currentPassword: string;
	password: string;
	confirmPassword: string;
}

/**
 * Sets or changes a signed-in account's password. When one exists the current password is
 * required, and wrong guesses count towards the same lockout as sign-in.
 */
export async function changePassword(
	store: AdminStore,
	account: Account,
	form: ChangePasswordForm,
	now: Date
): Promise<{ ok: true } | { ok: false; errors: FieldErrors }> {
	const stored = await store.getPasswordHash(account.id);
	const errors = newPasswordErrors(form.password, form.confirmPassword);

	if (stored) {
		const email = normalize(account.email);
		const failures = await store.countPasswordFailures(
			email,
			new Date(now.getTime() - LOCKOUT_WINDOW_MS)
		);
		if (failures >= LOCKOUT_ATTEMPTS) {
			errors.currentPassword =
				'Too many incorrect attempts. Try again in 15 minutes, or reset your password from the sign-in page.';
		} else if (!form.currentPassword) {
			errors.currentPassword = 'Enter your current password.';
		} else if (!(await verifyPassword(form.currentPassword, stored))) {
			await store.recordPasswordFailure(email, now);
			errors.currentPassword = 'Current password is incorrect.';
		}
	}

	if (Object.keys(errors).length) return { ok: false, errors };
	await store.setPasswordHash(account.id, await hashPassword(form.password));
	return { ok: true };
}
