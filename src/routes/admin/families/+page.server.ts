import { fail, redirect } from '@sveltejs/kit';
import { createFamily } from '#lib/server/admin-family-service.ts';
import { listFamilies } from '#lib/server/admin-service.ts';
import { formString, requireAdmin } from '#lib/server/admin-actions.ts';
import { getAppUrl, getMailer, getStore } from '#lib/server/context.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireAdmin(locals.account);
	return { families: await listFamilies(getStore()) };
};

export const actions: Actions = {
	create: async ({ locals, request }) => {
		requireAdmin(locals.account);
		const data = await request.formData();
		const values = {
			name: formString(data, 'name'),
			email: formString(data, 'email'),
			studentName: formString(data, 'studentName'),
			invite: formString(data, 'invite') === 'on'
		};
		const result = await createFamily(
			{ store: getStore(), mailer: getMailer(), appUrl: getAppUrl() },
			values
		);
		if (!result.ok) return fail(400, { values, errors: result.errors });
		redirect(
			303,
			`/admin/families/${result.value.accountId}?created=${values.invite ? 'invited' : '1'}`
		);
	}
};
