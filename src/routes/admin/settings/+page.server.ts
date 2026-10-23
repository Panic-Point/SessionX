import { fail } from '@sveltejs/kit';
import { validateSettings } from '#lib/server/admin-validation.ts';
import { formString, requireAdmin } from '#lib/server/admin-actions.ts';
import { getStore } from '#lib/server/context.ts';
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
	'adminEmail'
] as const;

type SettingsValues = Record<(typeof FIELDS)[number], string>;

export const load: PageServerLoad = async () => {
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
		adminEmail: s.adminEmail ?? ''
	};
	return { values };
};

export const actions: Actions = {
	default: async ({ locals, request }) => {
		requireAdmin(locals.account);
		const data = await request.formData();
		const values = Object.fromEntries(
			FIELDS.map((name) => [name, formString(data, name)])
		) as SettingsValues;

		const result = validateSettings(values);
		if (!result.ok) return fail(400, { values, errors: result.errors, saved: false });
		await getStore().updateSettings(result.value);
		return { values: null, errors: {}, saved: true };
	}
};
