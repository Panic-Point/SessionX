import { fail } from '@sveltejs/kit';
import { DateTime } from 'luxon';
import { validateOverride, validateWeeklyHours } from '#lib/server/admin-validation.ts';
import { formString, formStrings, requireAdmin } from '#lib/server/admin-actions.ts';
import { getStore } from '#lib/server/context.ts';
import type { Actions, PageServerLoad } from './$types';

interface Range {
	start: string;
	end: string;
}

/** Pairs repeated start/end fields, dropping rows left completely blank. */
function readRanges(data: FormData): Range[] {
	const starts = formStrings(data, 'start');
	const ends = formStrings(data, 'end');
	return starts
		.map((start, i) => ({ start, end: ends[i] ?? '' }))
		.filter((r) => r.start.trim() || r.end.trim());
}

export const load: PageServerLoad = async ({ locals }) => {
	requireAdmin(locals.account);
	const store = getStore();
	const { timezone } = await store.getSettings();
	const today = DateTime.now().setZone(timezone).toISODate()!;
	const [weekly, overrides] = await Promise.all([
		store.getWeeklyHours(),
		store.listDateOverrides(today)
	]);
	return {
		today,
		weekly,
		overrides: overrides.map((o) => ({
			...o,
			dateLabel: DateTime.fromISO(o.date).setLocale('en-US').toFormat('cccc, LLLL d, yyyy')
		}))
	};
};

export const actions: Actions = {
	weekly: async ({ locals, request }) => {
		requireAdmin(locals.account);
		const data = await request.formData();
		const weekdays = formStrings(data, 'weekday');
		const ends = formStrings(data, 'end');
		const rows = formStrings(data, 'start')
			.map((start, i) => ({ weekday: weekdays[i] ?? '', start, end: ends[i] ?? '' }))
			.filter((r) => r.start.trim() || r.end.trim());

		const result = validateWeeklyHours(rows);
		if (!result.ok) {
			return fail(400, {
				weekly: {
					rows: rows.map((r, i) => ({ ...r, error: result.errors[`row-${i}`] ?? null })),
					errors: result.errors
				}
			});
		}
		await getStore().replaceWeeklyHours(result.value);
		return { weekly: { saved: true as const } };
	},

	saveOverride: async ({ locals, request }) => {
		requireAdmin(locals.account);
		const data = await request.formData();
		const values = {
			date: formString(data, 'date'),
			isClosed: formString(data, 'isClosed') === 'on',
			note: formString(data, 'note'),
			ranges: readRanges(data)
		};
		const result = validateOverride(values);
		if (!result.ok) return fail(400, { override: { values, errors: result.errors } });
		await getStore().saveDateOverride(result.value);
		return { override: { saved: true as const } };
	},

	deleteOverride: async ({ locals, request }) => {
		requireAdmin(locals.account);
		await getStore().deleteDateOverride(formString(await request.formData(), 'date'));
		return { override: { deleted: true as const } };
	}
};
