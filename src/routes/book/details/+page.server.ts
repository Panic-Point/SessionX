import { fail, redirect } from '@sveltejs/kit';
import { DateTime } from 'luxon';
import {
	getMonthAvailability,
	submitGuestRequest,
	type GuestRequestForm
} from '#lib/server/booking-service.ts';
import { getAppUrl, getMailer, getStore } from '#lib/server/context.ts';
import { formatDateTime } from '#lib/server/format.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const typeId = url.searchParams.get('type');
	const start = url.searchParams.get('start');
	if (!typeId) redirect(303, '/book');

	const startsAt = new Date(start ?? '');
	if (Number.isNaN(startsAt.getTime())) {
		redirect(303, `/book?${new URLSearchParams({ type: typeId })}`);
	}

	const store = getStore();
	const { timezone } = await store.getSettings();
	const local = DateTime.fromJSDate(startsAt, { zone: timezone });
	const date = local.toISODate()!;
	const month = local.toFormat('yyyy-MM');

	const availability = await getMonthAvailability(store, typeId, month, new Date());
	if (!availability) redirect(303, '/book');

	const iso = startsAt.toISOString();
	return {
		lessonType: availability.lessonType,
		startsAt: iso,
		whenLabel: formatDateTime(startsAt, timezone),
		available: (availability.days[date] ?? []).some((t) => t.iso === iso),
		backHref: `/book?${new URLSearchParams({ type: typeId, month, date })}`
	};
};

export const actions: Actions = {
	default: async ({ request }) => {
		const data = await request.formData();
		const field = (name: string) => {
			const value = data.get(name);
			return typeof value === 'string' ? value : '';
		};
		const form: GuestRequestForm = {
			lessonTypeId: field('lessonTypeId'),
			startsAt: field('startsAt'),
			accountName: field('accountName'),
			email: field('email'),
			studentName: field('studentName'),
			note: field('note')
		};

		const result = await submitGuestRequest(
			{ store: getStore(), mailer: getMailer(), appUrl: getAppUrl() },
			form,
			new Date()
		);
		if (!result.ok) {
			return fail(400, {
				values: {
					accountName: form.accountName,
					email: form.email,
					studentName: form.studentName,
					note: form.note
				},
				errors: result.errors
			});
		}
		redirect(303, `/book/requested?${new URLSearchParams({ token: result.manageToken })}`);
	}
};
