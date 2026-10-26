import { error } from '@sveltejs/kit';
import { getManageView } from '#lib/server/booking-service.ts';
import { getStore } from '#lib/server/context.ts';
import type { PageServerLoad } from './$types';

// Manage-link holders haven't proven who they are: never send the account's name or email.
export const load: PageServerLoad = async ({ params }) => {
	const view = await getManageView(getStore(), params.token);
	if (!view) error(404, 'Booking not found');
	const live = view.status === 'pending' || view.status === 'approved';
	return {
		status: view.status,
		lessonTypeName: view.lessonTypeName,
		studentName: view.studentName,
		whenLabel: view.whenLabel,
		priceLabel: view.priceLabel,
		note: view.note,
		canCancel: live && view.startsAt.getTime() > Date.now()
	};
};
