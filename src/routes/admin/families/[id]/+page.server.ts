import { error, fail } from '@sveltejs/kit';
import {
	getFamily,
	saveAccountNotes,
	saveStudentNotes,
	saveStudentPrices
} from '#lib/server/admin-service.ts';
import {
	addFamilyStudent,
	ADMIN_BOOKING_FORM_FIELDS,
	bookForStudent,
	type AdminBookingForm
} from '#lib/server/admin-family-service.ts';
import { formString, requireAdmin } from '#lib/server/admin-actions.ts';
import { getAppUrl, getCalendar, getMailer, getStore } from '#lib/server/context.ts';
import { localToday } from '#lib/server/recurrence.ts';
import {
	createSeries,
	listFamilySeries,
	previewSeries,
	SERIES_FORM_FIELDS,
	type SeriesForm
} from '#lib/server/series-service.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireAdmin(locals.account);
	const store = getStore();
	const family = await getFamily(store, params.id);
	if (!family) error(404, 'Family not found.');
	const now = new Date();
	const [series, lessonTypes, settings] = await Promise.all([
		listFamilySeries(store, params.id, now),
		store.getActiveLessonTypes(),
		store.getSettings()
	]);
	return {
		family,
		series,
		lessonTypes: lessonTypes.map((t) => ({ id: t.id, name: t.name, durationMin: t.durationMin })),
		today: localToday(now, settings.timezone),
		/** Set right after the family was added on the Families page. */
		created: url.searchParams.get('created')
	};
};

function seriesForm(data: FormData): SeriesForm {
	const form = {} as SeriesForm;
	for (const field of SERIES_FORM_FIELDS) form[field] = formString(data, field);
	return form;
}

function bookingForm(data: FormData): AdminBookingForm {
	const form = {} as AdminBookingForm;
	for (const field of ADMIN_BOOKING_FORM_FIELDS) form[field] = formString(data, field);
	return form;
}

const PRICE_PREFIX = 'price-';

export const actions: Actions = {
	accountNotes: async ({ locals, request, params }) => {
		requireAdmin(locals.account);
		const notes = formString(await request.formData(), 'notes');
		const result = await saveAccountNotes(getStore(), params.id, notes);
		if (!result.ok)
			return fail(400, { kind: 'notes', target: 'account', errors: result.errors, notes });
		return { kind: 'notes', target: 'account', saved: true };
	},
	studentNotes: async ({ locals, request }) => {
		requireAdmin(locals.account);
		const data = await request.formData();
		const studentId = formString(data, 'studentId');
		const notes = formString(data, 'notes');
		const result = await saveStudentNotes(getStore(), studentId, notes);
		if (!result.ok)
			return fail(400, { kind: 'notes', target: studentId, errors: result.errors, notes });
		return { kind: 'notes', target: studentId, saved: true };
	},
	prices: async ({ locals, request }) => {
		requireAdmin(locals.account);
		const data = await request.formData();
		const studentId = formString(data, 'studentId');
		const prices: Record<string, string> = {};
		for (const [key, value] of data.entries()) {
			if (key.startsWith(PRICE_PREFIX) && typeof value === 'string') {
				prices[key.slice(PRICE_PREFIX.length)] = value;
			}
		}
		const result = await saveStudentPrices(getStore(), studentId, prices);
		if (!result.ok)
			return fail(400, { kind: 'prices', target: studentId, errors: result.errors, prices });
		return { kind: 'prices', target: studentId, saved: true };
	},
	addStudent: async ({ locals, request, params }) => {
		requireAdmin(locals.account);
		const name = formString(await request.formData(), 'name');
		const result = await addFamilyStudent(getStore(), params.id, name);
		if (!result.ok)
			return fail(400, { kind: 'student', target: 'new', errors: result.errors, name });
		return { kind: 'student', target: 'new', saved: true, name: name.trim() };
	},
	book: async ({ locals, request, params }) => {
		requireAdmin(locals.account);
		const values = bookingForm(await request.formData());
		const deps = {
			store: getStore(),
			mailer: getMailer(),
			appUrl: getAppUrl(),
			calendar: getCalendar()
		};
		const result = await bookForStudent(deps, params.id, values, new Date());
		if (!result.ok) {
			return fail(400, { kind: 'book', target: values.studentId, errors: result.errors, values });
		}
		return {
			kind: 'book',
			target: values.studentId,
			booked: { whenLabel: result.whenLabel, studentName: result.studentName }
		};
	},
	seriesPreview: async ({ locals, request, params }) => {
		requireAdmin(locals.account);
		const values = seriesForm(await request.formData());
		const deps = { store: getStore(), calendar: getCalendar() };
		const result = await previewSeries(deps, params.id, values, new Date());
		if (!result.ok) {
			return fail(400, { kind: 'series', target: values.studentId, errors: result.errors, values });
		}
		const p = result.preview;
		return {
			kind: 'series',
			target: values.studentId,
			values,
			preview: {
				scheduleLabel: p.scheduleLabel,
				lessonTypeName: p.lessonTypeName,
				priceLabel: p.priceLabel,
				endLabel: p.endLabel,
				bookable: p.bookable,
				continues: p.continues,
				dates: p.dates.map((d) => ({
					date: d.date,
					whenLabel: d.whenLabel,
					status: d.status,
					statusLabel: d.statusLabel
				}))
			}
		};
	},
	seriesCreate: async ({ locals, request, params }) => {
		requireAdmin(locals.account);
		const values = seriesForm(await request.formData());
		const deps = {
			store: getStore(),
			mailer: getMailer(),
			appUrl: getAppUrl(),
			calendar: getCalendar()
		};
		const result = await createSeries(deps, params.id, values, new Date());
		if (!result.ok) {
			return fail(400, { kind: 'series', target: values.studentId, errors: result.errors, values });
		}
		return {
			kind: 'series',
			target: values.studentId,
			created: { seriesId: result.seriesId, booked: result.booked, skipped: result.skipped }
		};
	}
};
