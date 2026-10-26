import { error, fail, redirect } from '@sveltejs/kit';
import { cancelLesson, getCancelView } from '#lib/server/account-service.ts';
import { readShownLate, toCancelPageData } from '#lib/server/cancel-page.ts';
import { getAppUrl, getMailer, getStore } from '#lib/server/context.ts';
import type { CancelTarget } from '#lib/server/store/types.ts';
import type { Actions, PageServerLoad } from './$types';

// Holding the manage link is enough to cancel, but not to see who booked: no account name or email.
export const load: PageServerLoad = async ({ params }) => {
	const target: CancelTarget = { kind: 'token', manageToken: params.token };
	const view = await getCancelView(getStore(), target, new Date());
	if (!view) error(404, 'Booking not found');
	return { lesson: toCancelPageData(view) };
};

export const actions: Actions = {
	default: async ({ params, request }) => {
		const target: CancelTarget = { kind: 'token', manageToken: params.token };
		const result = await cancelLesson(
			{ store: getStore(), mailer: getMailer(), appUrl: getAppUrl() },
			target,
			new Date(),
			readShownLate(await request.formData())
		);
		if (!result.ok) {
			return fail(400, { message: result.message, lateChanged: result.lateChanged ?? false });
		}
		redirect(303, `/manage/${encodeURIComponent(params.token)}`);
	}
};
