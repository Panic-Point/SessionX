import { fail } from '@sveltejs/kit';
import { requireAccount } from '#lib/server/account-guard.ts';
import { addMyStudent, getAccountHome, renameMyStudent } from '#lib/server/account-service.ts';
import { changePassword } from '#lib/server/auth/password-service.ts';
import { formString } from '#lib/server/admin-actions.ts';
import { getStore } from '#lib/server/context.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const account = requireAccount(locals.account);
	const store = getStore();
	const home = await getAccountHome(store, account.id, new Date());
	return {
		// Only id and name: student notes are the teacher's.
		students: home.students.map((s) => ({ id: s.id, name: s.name })),
		upcoming: home.upcoming,
		past: home.past,
		cancelled: url.searchParams.get('cancelled') === '1',
		email: account.email,
		hasPassword: (await store.getPasswordHash(account.id)) !== null
	};
};

export const actions: Actions = {
	addStudent: async ({ locals, request }) => {
		const account = requireAccount(locals.account);
		const name = formString(await request.formData(), 'name');
		const result = await addMyStudent(getStore(), account.id, name);
		if (!result.ok) {
			return fail(400, { target: 'add', values: { name }, errors: result.errors, message: null });
		}
		return {
			target: 'add',
			values: null,
			errors: {},
			message: `Added ${result.student.name}.`
		};
	},

	renameStudent: async ({ locals, request }) => {
		const account = requireAccount(locals.account);
		const data = await request.formData();
		const id = formString(data, 'id');
		const name = formString(data, 'name');
		const result = await renameMyStudent(getStore(), account.id, id, name);
		if (!result.ok) {
			return fail(400, { target: id, values: { name }, errors: result.errors, message: null });
		}
		return { target: id, values: null, errors: {}, message: `Saved ${name.trim()}.` };
	},

	password: async ({ locals, request }) => {
		const account = requireAccount(locals.account);
		const data = await request.formData();
		const store = getStore();
		const hadPassword = (await store.getPasswordHash(account.id)) !== null;
		const result = await changePassword(
			store,
			account,
			{
				currentPassword: formString(data, 'currentPassword'),
				password: formString(data, 'password'),
				confirmPassword: formString(data, 'confirmPassword')
			},
			new Date()
		);
		if (!result.ok) {
			return fail(400, { target: 'password', values: null, errors: result.errors, message: null });
		}
		return {
			target: 'password',
			values: null,
			errors: {},
			message: hadPassword ? 'Password changed.' : 'Password set. You can now sign in with it.'
		};
	}
};
