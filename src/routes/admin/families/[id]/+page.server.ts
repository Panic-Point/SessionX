import { error, fail } from '@sveltejs/kit';
import {
	getFamily,
	saveAccountNotes,
	saveStudentNotes,
	saveStudentPrices
} from '#lib/server/admin-service.ts';
import { formString, requireAdmin } from '#lib/server/admin-actions.ts';
import { getStore } from '#lib/server/context.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	requireAdmin(locals.account);
	const family = await getFamily(getStore(), params.id);
	if (!family) error(404, 'Family not found.');
	return { family };
};

const PRICE_PREFIX = 'price-';

export const actions: Actions = {
	accountNotes: async ({ locals, request, params }) => {
		requireAdmin(locals.account);
		const notes = formString(await request.formData(), 'notes');
		const result = await saveAccountNotes(getStore(), params.id, notes);
		if (!result.ok)
			return fail(400, { kind: 'notes', target: 'account', errors: result.errors, notes });
		return { kind: 'notes', target: 'account', saved: true };
	},
	studentNotes: async ({ locals, request }) => {
		requireAdmin(locals.account);
		const data = await request.formData();
		const studentId = formString(data, 'studentId');
		const notes = formString(data, 'notes');
		const result = await saveStudentNotes(getStore(), studentId, notes);
		if (!result.ok)
			return fail(400, { kind: 'notes', target: studentId, errors: result.errors, notes });
		return { kind: 'notes', target: studentId, saved: true };
	},
	prices: async ({ locals, request }) => {
		requireAdmin(locals.account);
		const data = await request.formData();
		const studentId = formString(data, 'studentId');
		const prices: Record<string, string> = {};
		for (const [key, value] of data.entries()) {
			if (key.startsWith(PRICE_PREFIX) && typeof value === 'string') {
				prices[key.slice(PRICE_PREFIX.length)] = value;
			}
		}
		const result = await saveStudentPrices(getStore(), studentId, prices);
		if (!result.ok)
			return fail(400, { kind: 'prices', target: studentId, errors: result.errors, prices });
		return { kind: 'prices', target: studentId, saved: true };
	}
};
