import { error, fail } from '@sveltejs/kit';
import {
	cancelledMessage,
	formNotify,
	formString,
	requireAdmin
} from '#lib/server/admin-actions.ts';
import { getAppUrl, getCalendar, getMailer, getStore } from '#lib/server/context.ts';
import { adminCancelLesson, endSeries, getSeriesPage } from '#lib/server/series-service.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	requireAdmin(locals.account);
	const page = await getSeriesPage(getStore(), params.id, new Date());
	if (!page) error(404, 'Series not found.');
	return page;
};

function deps() {
	return { store: getStore(), mailer: getMailer(), appUrl: getAppUrl(), calendar: getCalendar() };
}

export const actions: Actions = {
	cancelLesson: async ({ locals, request }) => {
		requireAdmin(locals.account);
		const data = await request.formData();
		const notify = formNotify(data);
		const result = await adminCancelLesson(deps(), formString(data, 'id'), new Date(), '', notify);
		if (!result.ok) return fail(400, { message: result.message });
		return { message: cancelledMessage('Lesson cancelled.', notify) };
	},
	endFrom: async ({ locals, request, params }) => {
		requireAdmin(locals.account);
		const data = await request.formData();
		const from = formString(data, 'from');
		const notify = formNotify(data);
		const result = await endSeries(
			deps(),
			params.id,
			from ? new Date(from) : null,
			new Date(),
			notify
		);
		if (!result.ok) return fail(400, { message: result.message });
		const n = result.cancelled ?? 0;
		return {
			message:
				n === 0
					? 'Series ended. There were no upcoming lessons to cancel.'
					: cancelledMessage(
							`Series ended and ${n} ${n === 1 ? 'lesson' : 'lessons'} cancelled.`,
							notify
						)
		};
	}
};
