import type { Account, AdminStore } from '../store/types';
import type { Mailer } from '../email/mailer';
import { loginLinkEmail } from '../email/templates';
import { generateToken, hashToken } from './tokens';

export interface LoginDeps {
	store: AdminStore;
	mailer: Mailer;
	appUrl: string;
}

const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000;

/** Silent no-op for unknown emails so callers cannot enumerate accounts. */
export async function requestLoginLink(deps: LoginDeps, email: string, now: Date): Promise<void> {
	const normalized = email.trim().toLowerCase();
	const account = await deps.store.findAccountByEmail(normalized);
	if (!account) return;
	const token = generateToken();
	await deps.store.createLoginToken(
		account.id,
		await hashToken(token),
		new Date(now.getTime() + LOGIN_TOKEN_TTL_MS)
	);
	const url = `${deps.appUrl.replace(/\/+$/, '')}/login/verify?token=${token}`;
	try {
		await deps.mailer.send(loginLinkEmail(account.email, account.name, url));
	} catch (err) {
		console.error('Failed to send login link email', err);
	}
}

export async function completeLogin(
	store: AdminStore,
	token: string,
	now: Date
): Promise<Account | null> {
	const accountId = await store.consumeLoginToken(await hashToken(token), now);
	return accountId ? store.findAccountById(accountId) : null;
}
