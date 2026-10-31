import { fail, redirect } from '@sveltejs/kit';
import { requireAccount } from '#lib/server/account-guard.ts';
import { deleteMyAccount, getAccountHome } from '#lib/server/account-service.ts';
import { changePassword } from '#lib/server/auth/password-service.ts';
import { SESSION_COOKIE } from '#lib/server/auth/session.ts';
import { startSession } from '#lib/server/auth/start-session.ts';
import { formString } from '#lib/server/admin-actions.ts';
import { getAppUrl, getCalendar, getMailer, getStore } from '#lib/server/context.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const account = requireAccount(locals.account);
	const store = getStore();
	const [hash, home, settings] = await Promise.all([
		store.getPasswordHash(account.id),
		getAccountHome(store, account.id, new Date()),
		store.getSettings()
	]);
	return {
		email: account.email,
		hasPassword: hash !== null,
		canDelete: account.role === 'client',
		upcomingCount: home.upcoming.length,
		cutoffHours: settings.cancelCutoffHours
	};
};

export const actions: Actions = {
	password: async ({ locals, request, cookies }) => {
		const account = requireAccount(locals.account);
		const data = await request.formData();
		const store = getStore();
		const now = new Date();
		const hadPassword = (await store.getPasswordHash(account.id)) !== null;
		const result = await changePassword(
			store,
			account,
			{
				currentPassword: formString(data, 'currentPassword'),
				password: formString(data, 'password'),
				confirmPassword: formString(data, 'confirmPassword')
			},
			now
		);
		if (!result.ok) {
			return fail(400, { target: 'password', errors: result.errors, message: null });
		}
		// The new password revoked every session, this one included; keep this device signed in.
		await startSession(cookies, account, now);
		return {
			target: 'password',
			errors: {},
			message: hadPassword ? 'Password changed.' : 'Password set. You can now sign in with it.'
		};
	},

	signOutEverywhere: async ({ locals, cookies }) => {
		const account = requireAccount(locals.account);
		await getStore().revokeSessions(account.id);
		cookies.delete(SESSION_COOKIE, { path: '/' });
		redirect(303, '/?signedOutEverywhere=1');
	},

	deleteAccount: async ({ locals, request, cookies }) => {
		const account = requireAccount(locals.account);
		const data = await request.formData();
		const result = await deleteMyAccount(
			{ store: getStore(), mailer: getMailer(), appUrl: getAppUrl(), calendar: getCalendar() },
			account,
			{
				currentPassword: formString(data, 'deletePassword'),
				confirmEmail: formString(data, 'confirmEmail')
			},
			new Date()
		);
		if (!result.ok) {
			return fail(400, { target: 'delete', errors: result.errors, message: null });
		}
		cookies.delete(SESSION_COOKIE, { path: '/' });
		redirect(303, '/?accountDeleted=1');
	}
};
