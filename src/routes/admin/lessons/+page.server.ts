import { fail } from '@sveltejs/kit';
import { listLessons, setLessonPaid } from '#lib/server/admin-service.ts';
import { formString, requireAdmin } from '#lib/server/admin-actions.ts';
import { getStore } from '#lib/server/context.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireAdmin(locals.account);
	const range: 'upcoming' | 'past' = url.searchParams.get('range') === 'past' ? 'past' : 'upcoming';
	const unpaidOnly = url.searchParams.get('unpaid') === '1';
	const lessons = await listLessons(getStore(), { range, unpaidOnly }, new Date());
	return {
		range,
		unpaidOnly,
		lessons: lessons.map((l) => ({
			id: l.id,
			studentName: l.studentName,
			accountName: l.accountName,
			accountEmail: l.accountEmail,
			lessonTypeName: l.lessonTypeName,
			durationMin: l.durationMin,
			whenLabel: l.whenLabel,
			priceLabel: l.priceLabel,
			paid: l.paid
		}))
	};
};

async function markPaid(locals: App.Locals, request: Request, paid: boolean) {
	requireAdmin(locals.account);
	const id = formString(await request.formData(), 'id');
	const result = await setLessonPaid(getStore(), id, paid, new Date());
	if (!result.ok) return fail(400, { message: result.message });
	return { message: null };
}

export const actions: Actions = {
	paid: ({ locals, request }) => markPaid(locals, request, true),
	unpaid: ({ locals, request }) => markPaid(locals, request, false)
};
