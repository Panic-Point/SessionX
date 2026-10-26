import { fail } from '@sveltejs/kit';
import { validateSettings } from '#lib/server/admin-validation.ts';
import { formString, requireAdmin } from '#lib/server/admin-actions.ts';
import { checkCalendarConnection } from '#lib/server/calendar/check.ts';
import { getCalendar, getCalendarStatus, getStore } from '#lib/server/context.ts';
import type { Actions, PageServerLoad } from './$types';

const FIELDS = [
	'timezone',
	'minNoticeHours',
	'maxAdvanceDays',
	'slotIncrementMin',
	'bufferMin',
	'allowSameDay',
	'cancelCutoffHours',
	'cancellationPolicyText',
	'adminEmail',
	'gcalWriteCalendarId',
	'gcalBusyCalendarIds'
] as const;

type SettingsValues = Record<(typeof FIELDS)[number], string>;

export const load: PageServerLoad = async ({ locals }) => {
	requireAdmin(locals.account);
	const s = await getStore().getSettings();
	const values: SettingsValues = {
		timezone: s.timezone,
		minNoticeHours: String(s.minNoticeHours),
		maxAdvanceDays: String(s.maxAdvanceDays),
		slotIncrementMin: String(s.slotIncrementMin),
		bufferMin: String(s.bufferMin),
		allowSameDay: s.allowSameDay ? 'on' : '',
		cancelCutoffHours: String(s.cancelCutoffHours),
		cancellationPolicyText: s.cancellationPolicyText,
		adminEmail: s.adminEmail ?? '',
		gcalWriteCalendarId: s.gcalWriteCalendarId ?? '',
		gcalBusyCalendarIds: s.gcalBusyCalendarIds.join('\n')
	};
	// Only the public service-account email and a secret-free error: never the key or raw env.
	const { serviceAccountEmail, configError } = getCalendarStatus();
	return { values, calendar: { serviceAccountEmail, configError } };
};

export const actions: Actions = {
	save: async ({ locals, request }) => {
		requireAdmin(locals.account);
		const data = await request.formData();
		const values = Object.fromEntries(
			FIELDS.map((name) => [name, formString(data, name)])
		) as SettingsValues;

		const result = validateSettings(values);
		if (!result.ok) return fail(400, { values, errors: result.errors, saved: false });
		await getStore().updateSettings(result.value);
		return { values: null, errors: {}, saved: true };
	},

	/** Checks the saved calendars (not unsaved form edits) against Google. */
	checkConnection: async ({ locals }) => {
		requireAdmin(locals.account);
		const settings = await getStore().getSettings();
		return { check: await checkCalendarConnection(getCalendar(), settings, new Date()) };
	}
};
