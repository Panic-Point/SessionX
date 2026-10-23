import { redirect } from '@sveltejs/kit';
import { DateTime } from 'luxon';
import { getMonthAvailability, listLessonTypes } from '#lib/server/booking-service.ts';
import { pickSelectedDate } from '#lib/booking-page.ts';
import { getStore } from '#lib/server/context.ts';
import type { PageServerLoad } from './$types';

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

export const load: PageServerLoad = async ({ url }) => {
	const store = getStore();
	const typeId = url.searchParams.get('type');

	if (!typeId) {
		return { step: 'type' as const, lessonTypes: await listLessonTypes(store) };
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

	const availability = await getMonthAvailability(store, typeId, month, now);
	if (!availability) redirect(303, '/book');

	const available: Record<string, number> = {};
	for (const [date, times] of Object.entries(availability.days)) {
		if (times.length > 0) available[date] = times.length;
	}
	const selectedDate = pickSelectedDate(availability.days, url.searchParams.get('date'));

	return {
		step: 'time' as const,
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
