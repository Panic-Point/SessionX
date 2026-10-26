import { fail, redirect } from '@sveltejs/kit';
import { DateTime } from 'luxon';
import {
	getMonthAvailability,
	submitAccountRequest,
	submitGuestRequest,
	type AccountRequestForm,
	type GuestRequestForm,
	type StudentChoice
} from '#lib/server/booking-service.ts';
import { formString } from '#lib/server/admin-actions.ts';
import { getAppUrl, getCalendar, getMailer, getStore } from '#lib/server/context.ts';
import { formatDateTime } from '#lib/server/format.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const typeId = url.searchParams.get('type');
	const start = url.searchParams.get('start');
	if (!typeId) redirect(303, '/book');

	const store = getStore();
	const account = locals.account;

	// Signed in, the request is for one of the account's students; anything else restarts at the
	// student picker rather than falling back to guest pricing.
	let student: { id: string; name: string } | null = null;
	let choice: StudentChoice | undefined;
	if (account) {
		const studentId = url.searchParams.get('student');
		const found = studentId
			? (await store.listStudents(account.id)).find((s) => s.id === studentId)
			: undefined;
		if (!found) redirect(303, '/book');
		student = { id: found.id, name: found.name };
		choice = { accountId: account.id, studentId: found.id };
	}
	const withStudent = (params: Record<string, string>) =>
		new URLSearchParams(student ? { student: student.id, ...params } : params);

	const startsAt = new Date(start ?? '');
	if (Number.isNaN(startsAt.getTime())) {
		redirect(303, `/book?${withStudent({ type: typeId })}`);
	}

	const { timezone } = await store.getSettings();
	const local = DateTime.fromJSDate(startsAt, { zone: timezone });
	const date = local.toISODate()!;
	const month = local.toFormat('yyyy-MM');

	const availability = await getMonthAvailability(
		store,
		typeId,
		month,
		new Date(),
		choice,
		getCalendar()
	);
	if (!availability) redirect(303, '/book');

	const iso = startsAt.toISOString();
	return {
		lessonType: availability.lessonType,
		student,
		startsAt: iso,
		whenLabel: formatDateTime(startsAt, timezone),
		available: (availability.days[date] ?? []).some((t) => t.iso === iso),
		backHref: `/book?${withStudent({ type: typeId, month, date })}`
	};
};

export const actions: Actions = {
	default: async ({ locals, request }) => {
		const data = await request.formData();
		const field = (name: string) => formString(data, name);
		const deps = {
			store: getStore(),
			mailer: getMailer(),
			appUrl: getAppUrl(),
			calendar: getCalendar()
		};

		// Signed in, always book as the account: never create a guest request for a signed-in user.
		if (locals.account) {
			const form: AccountRequestForm = {
				lessonTypeId: field('lessonTypeId'),
				startsAt: field('startsAt'),
				studentId: field('studentId'),
				note: field('note')
			};
			const result = await submitAccountRequest(deps, locals.account.id, form, new Date());
			if (!result.ok) {
				return fail(400, {
					values: { accountName: '', email: '', studentName: '', note: form.note },
					errors: result.errors
				});
			}
			redirect(303, `/book/requested?${new URLSearchParams({ token: result.manageToken })}`);
		}

		const form: GuestRequestForm = {
			lessonTypeId: field('lessonTypeId'),
			startsAt: field('startsAt'),
			accountName: field('accountName'),
			email: field('email'),
			studentName: field('studentName'),
			note: field('note')
		};

		const result = await submitGuestRequest(deps, form, new Date());
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
