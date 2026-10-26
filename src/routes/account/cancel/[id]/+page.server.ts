import { error, fail, redirect } from '@sveltejs/kit';
import { requireAccount } from '#lib/server/account-guard.ts';
import { cancelLesson, getCancelView } from '#lib/server/account-service.ts';
import { readShownLate, toCancelPageData } from '#lib/server/cancel-page.ts';
import { getAppUrl, getCalendar, getMailer, getStore } from '#lib/server/context.ts';
import type { CancelTarget } from '#lib/server/store/types.ts';
import type { Actions, PageServerLoad } from './$types';

// Another account's booking id behaves exactly like an unknown id: the store only matches
// bookings whose student belongs to this account.
export const load: PageServerLoad = async ({ locals, params }) => {
	const account = requireAccount(locals.account);
	const target: CancelTarget = { kind: 'account', bookingId: params.id, accountId: account.id };
	const view = await getCancelView(getStore(), target, new Date());
	if (!view) error(404, 'Lesson not found');
	return { lesson: toCancelPageData(view) };
};

export const actions: Actions = {
	default: async ({ locals, params, request }) => {
		const account = requireAccount(locals.account);
		const target: CancelTarget = { kind: 'account', bookingId: params.id, accountId: account.id };
		const result = await cancelLesson(
			{ store: getStore(), mailer: getMailer(), appUrl: getAppUrl(), calendar: getCalendar() },
			target,
			new Date(),
			readShownLate(await request.formData())
		);
		if (!result.ok) {
			return fail(400, { message: result.message, lateChanged: result.lateChanged ?? false });
		}
		redirect(303, '/account?cancelled=1');
	}
};
