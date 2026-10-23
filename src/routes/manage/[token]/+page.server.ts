import { error } from '@sveltejs/kit';
import { getManageView } from '#lib/server/booking-service.ts';
import { getStore } from '#lib/server/context.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const view = await getManageView(getStore(), params.token);
	if (!view) error(404, 'Booking not found');
	return {
		status: view.status,
		lessonTypeName: view.lessonTypeName,
		studentName: view.studentName,
		accountName: view.accountName,
		whenLabel: view.whenLabel,
		priceLabel: view.priceLabel,
		note: view.note
	};
};
