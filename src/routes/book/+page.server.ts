import { fail, redirect } from '@sveltejs/kit';
import { DateTime } from 'luxon';
import { requireAccount } from '#lib/server/account-guard.ts';
import { addMyStudent } from '#lib/server/account-service.ts';
import { formString } from '#lib/server/admin-actions.ts';
import {
	getMonthAvailability,
	listLessonTypes,
	listLessonTypesFor,
	type StudentChoice
} from '#lib/server/booking-service.ts';
import { pickSelectedDate } from '#lib/booking-page.ts';
import { getStore } from '#lib/server/context.ts';
import type { AppStore } from '#lib/server/store/types.ts';
import type { Actions, PageServerLoad } from './$types';

const MONTH_PATTERN = /^\d{4}-\d{2}$/;

/** "America/New_York" → "Eastern Time"; falls back to the zone id. */
function timezoneLabel(timezone: string): string {
	try {
		const part = new Intl.DateTimeFormat('en-US', {
			timeZone: timezone,
			timeZoneName: 'longGeneric'
		})
			.formatToParts(new Date())
			.find((p) => p.type === 'timeZoneName');
		return part?.value ?? timezone;
	} catch {
		return timezone;
	}
}

/**
 * Signed in, the lesson is for one of the account's students. A `student` param that isn't this
 * account's goes back to the picker: it must never fall back to guest pricing.
 */
async function chosenStudent(
	store: AppStore,
	accountId: string,
	studentId: string | null
): Promise<{ id: string; name: string } | null> {
	if (!studentId) return null;
	const student = (await store.listStudents(accountId)).find((s) => s.id === studentId);
	if (!student) redirect(303, '/book');
	return { id: student.id, name: student.name };
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const store = getStore();
	const typeId = url.searchParams.get('type');
	const account = locals.account;

	let student: { id: string; name: string } | null = null;
	let choice: StudentChoice | undefined;
	if (account) {
		student = await chosenStudent(store, account.id, url.searchParams.get('student'));
		if (!student) {
			const students = await store.listStudents(account.id);
			return {
				step: 'student' as const,
				student: null,
				students: students.map((s) => ({ id: s.id, name: s.name }))
			};
		}
		choice = { accountId: account.id, studentId: student.id };
	}

	if (!typeId) {
		const lessonTypes = choice
			? await listLessonTypesFor(store, choice)
			: await listLessonTypes(store);
		if (!lessonTypes) redirect(303, '/book');
		return { step: 'type' as const, student, lessonTypes };
	}

	const now = new Date();
	const settings = await store.getSettings();
	const zone = settings.timezone;
	const currentMonth = DateTime.fromJSDate(now, { zone }).toFormat('yyyy-MM');
	const lastMonth = DateTime.fromJSDate(now, { zone })
		.plus({ days: settings.maxAdvanceDays })
		.toFormat('yyyy-MM');

	// yyyy-MM strings compare correctly as plain strings.
	const requested = url.searchParams.get('month') ?? '';
	const month =
		MONTH_PATTERN.test(requested) && requested >= currentMonth && requested <= lastMonth
			? requested
			: currentMonth;

	const availability = await getMonthAvailability(store, typeId, month, now, choice);
	if (!availability) {
		redirect(303, student ? `/book?${new URLSearchParams({ student: student.id })}` : '/book');
	}

	const available: Record<string, number> = {};
	for (const [date, times] of Object.entries(availability.days)) {
		if (times.length > 0) available[date] = times.length;
	}
	const selectedDate = pickSelectedDate(availability.days, url.searchParams.get('date'));

	return {
		step: 'time' as const,
		student,
		lessonType: availability.lessonType,
		month,
		currentMonth,
		lastMonth,
		available,
		selectedDate,
		times: selectedDate ? availability.days[selectedDate] : [],
		timezoneLabel: timezoneLabel(zone)
	};
};

export const actions: Actions = {
	/** Signed-in "Add a student" on the picker; continues booking for the new student. */
	addStudent: async ({ locals, request }) => {
		const account = requireAccount(locals.account);
		const name = formString(await request.formData(), 'name');
		const result = await addMyStudent(getStore(), account.id, name);
		if (!result.ok) return fail(400, { values: { name }, errors: result.errors });
		redirect(303, `/book?${new URLSearchParams({ student: result.student.id })}`);
	}
};
