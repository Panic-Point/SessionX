import { fail } from '@sveltejs/kit';
import { validateLessonType } from '#lib/server/admin-validation.ts';
import { formString, requireAdmin } from '#lib/server/admin-actions.ts';
import { getStore } from '#lib/server/context.ts';
import { AdminStoreError } from '#lib/server/store/types.ts';
import type { Actions, PageServerLoad } from './$types';

const FIELDS = ['name', 'description', 'durationMin', 'price', 'sortOrder', 'active'] as const;

type LessonTypeValues = Record<(typeof FIELDS)[number], string>;

function readValues(data: FormData): LessonTypeValues {
	return Object.fromEntries(
		FIELDS.map((name) => [name, formString(data, name)])
	) as LessonTypeValues;
}

export const load: PageServerLoad = async () => {
	const types = await getStore().listAllLessonTypes();
	return {
		lessonTypes: types.map((t) => ({
			id: t.id,
			active: t.active,
			durationMin: t.durationMin,
			priceLabel: `$${(t.priceCents / 100).toFixed(2)}`,
			values: {
				name: t.name,
				description: t.description,
				durationMin: String(t.durationMin),
				price: (t.priceCents / 100).toFixed(2),
				sortOrder: String(t.sortOrder),
				active: t.active ? 'on' : ''
			} satisfies LessonTypeValues
		}))
	};
};

export const actions: Actions = {
	create: async ({ locals, request }) => {
		requireAdmin(locals.account);
		const values = readValues(await request.formData());
		const result = validateLessonType(values);
		if (!result.ok) {
			return fail(400, { target: 'create', values, errors: result.errors, message: null });
		}
		const created = await getStore().createLessonType(result.value);
		return { target: 'create', values: null, errors: {}, message: `Added “${created.name}”.` };
	},

	update: async ({ locals, request }) => {
		requireAdmin(locals.account);
		const data = await request.formData();
		const id = formString(data, 'id');
		const values = readValues(data);
		const result = validateLessonType(values);
		if (!result.ok) {
			return fail(400, { target: id, values, errors: result.errors, message: null });
		}
		try {
			const updated = await getStore().updateLessonType(id, result.value);
			return { target: id, values: null, errors: {}, message: `Saved “${updated.name}”.` };
		} catch (e) {
			if (e instanceof AdminStoreError && e.code === 'not_found') {
				return fail(404, {
					target: id,
					values,
					errors: { form: 'This lesson type no longer exists.' },
					message: null
				});
			}
			throw e;
		}
	}
};
