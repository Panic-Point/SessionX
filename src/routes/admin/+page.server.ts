import { fail } from '@sveltejs/kit';
import { decideRequest, listPendingRequests } from '#lib/server/admin-service.ts';
import { formString, requireAdmin } from '#lib/server/admin-actions.ts';
import { getAppUrl, getCalendar, getMailer, getStore } from '#lib/server/context.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireAdmin(locals.account);
	const requests = await listPendingRequests(getStore(), new Date());
	return {
		requests: requests.map((r) => ({
			id: r.id,
			studentName: r.studentName,
			accountName: r.accountName,
			accountEmail: r.accountEmail,
			lessonTypeName: r.lessonTypeName,
			durationMin: r.durationMin,
			whenLabel: r.whenLabel,
			priceLabel: r.priceLabel,
			note: r.note
		}))
	};
};

async function decide(locals: App.Locals, request: Request, decision: 'approved' | 'declined') {
	requireAdmin(locals.account);
	const data = await request.formData();
	const id = formString(data, 'id');
	const result = await decideRequest(
		{ store: getStore(), mailer: getMailer(), appUrl: getAppUrl(), calendar: getCalendar() },
		id,
		decision,
		formString(data, 'reason'),
		new Date()
	);
	if (!result.ok) return fail(400, { id, ok: false as const, message: result.message });
	return {
		id,
		ok: true as const,
		message:
			decision === 'approved'
				? 'Request approved. The booker has been emailed.'
				: 'Request declined. The booker has been emailed.'
	};
}

export const actions: Actions = {
	approve: ({ locals, request }) => decide(locals, request, 'approved'),
	decline: ({ locals, request }) => decide(locals, request, 'declined')
};
