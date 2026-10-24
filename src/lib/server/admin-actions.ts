import { error, redirect } from '@sveltejs/kit';
import { adminGuard } from './admin-guard';
import type { Account } from './store/types';

/**
 * Enforces `adminGuard` inside a load or form action: 303 to /login when signed out, 403 for
 * non-admins. Form actions must call this themselves because they don't run layout loads.
 */
export function requireAdmin(account: Account | null): Account {
	const guard = adminGuard(account);
	if (guard.kind === 'redirect') redirect(303, guard.location);
	if (guard.kind === 'forbidden') error(403, 'Only the studio admin can view this page.');
	return account!;
}

/** A form field as a string ('' when missing or a file). */
export function formString(data: FormData, name: string): string {
	const value = data.get(name);
	return typeof value === 'string' ? value : '';
}

/** Every value of a repeated form field as strings. */
export function formStrings(data: FormData, name: string): string[] {
	return data.getAll(name).map((v) => (typeof v === 'string' ? v : ''));
}
