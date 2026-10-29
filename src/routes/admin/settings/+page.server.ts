import { fail } from '@sveltejs/kit';
import { validateSettings } from '#lib/server/admin-validation.ts';
import { formString, requireAdmin } from '#lib/server/admin-actions.ts';
import { checkCalendarConnection } from '#lib/server/calendar/check.ts';
import { syncLessonsToCalendar } from '#lib/server/calendar/sync.ts';
import { getAppUrl, getCalendar, getCalendarStatus, getStore } from '#lib/server/context.ts';
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
	},

	/** Adds upcoming approved lessons that aren't on the lesson calendar yet, one batch per click. */
	syncLessons: async ({ locals }) => {
		requireAdmin(locals.account);
		const settings = await getStore().getSettings();
		const calendar = getCalendar();
		if (!calendar.enabled || !settings.gcalWriteCalendarId) {
			return { sync: { ok: false, lines: [SYNC_NOT_READY] } };
		}
		const deps = { store: getStore(), calendar, appUrl: getAppUrl() };
		const r = await syncLessonsToCalendar(deps, settings, new Date());
		const lines: string[] = [];
		if (r.added > 0) lines.push(`Added ${plural(r.added)}.`);
		if (r.failed > 0) {
			lines.push(`Could not add ${plural(r.failed)}. Click Check connection to see why.`);
		}
		if (r.remaining > r.failed) {
			lines.push(`${plural(r.remaining)} still to add. Click Add lessons again.`);
		}
		if (lines.length === 0) lines.push(SYNC_NOTHING);
		return { sync: { ok: r.failed === 0, lines } };
	}
};

const SYNC_NOT_READY =
	'Set up Google Calendar and save a lesson calendar first, then click Check connection.';
const SYNC_NOTHING = 'All upcoming lessons are already on the calendar.';

function plural(n: number): string {
	return `${n} ${n === 1 ? 'lesson' : 'lessons'}`;
}
