import { fail } from '@sveltejs/kit';
import { listLessons, setLessonPaid, summarizeLessons } from '#lib/server/admin-service.ts';
import { parsePeriod, periodQuery } from '#lib/server/periods.ts';
import { formString, requireAdmin } from '#lib/server/admin-actions.ts';
import { getAppUrl, getCalendar, getMailer, getStore } from '#lib/server/context.ts';
import { adminCancelLesson } from '#lib/server/series-service.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireAdmin(locals.account);
	const store = getStore();
	const now = new Date();
	const { timezone } = await store.getSettings();
	const period = parsePeriod(url.searchParams, timezone, now);
	const param = url.searchParams.get('range');
	// Upcoming and past mean nothing inside a period, so only late cancels stay a separate view.
	const range: 'upcoming' | 'past' | 'late-cancels' =
		param === 'late-cancels' || (param === 'past' && !period) ? param : 'upcoming';
	const unpaidOnly = range !== 'late-cancels' && url.searchParams.get('unpaid') === '1';
	// A period that cannot be shown (start after end) lists nothing.
	const lessons =
		period && !period.range
			? []
			: await listLessons(store, { range, unpaidOnly, period: period?.range }, now);
	return {
		range,
		unpaidOnly,
		period: period && { ...period, range: undefined },
		periodQuery: period ? periodQuery(url.searchParams) : {},
		summary: period?.range ? summarizeLessons(lessons, range === 'late-cancels') : null,
		lessons: lessons.map((l) => ({
			id: l.id,
			studentName: l.studentName,
			accountName: l.accountName,
			accountEmail: l.accountEmail,
			lessonTypeName: l.lessonTypeName,
			durationMin: l.durationMin,
			whenLabel: l.whenLabel,
			priceLabel: l.priceLabel,
			paid: l.paid,
			seriesId: l.series?.id ?? null,
			seriesLabel: l.seriesLabel,
			canCancel: l.status === 'approved' && l.startsAt.getTime() > now.getTime()
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
	unpaid: ({ locals, request }) => markPaid(locals, request, false),
	cancel: async ({ locals, request }) => {
		requireAdmin(locals.account);
		const data = await request.formData();
		const deps = {
			store: getStore(),
			mailer: getMailer(),
			appUrl: getAppUrl(),
			calendar: getCalendar()
		};
		const result = await adminCancelLesson(
			deps,
			formString(data, 'id'),
			new Date(),
			formString(data, 'reason')
		);
		if (!result.ok) return fail(400, { message: result.message });
		return { message: null, cancelled: 'Lesson cancelled. The family has been emailed.' };
	}
};
