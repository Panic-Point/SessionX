import type { Interval } from '../availability';
import type { AdminBooking, AppStore, StudioSettings } from '../store/types';
import type { CalendarClient, CalendarEventInput } from './types';

/** Busy intervals from the configured calendars. Fails open: any problem yields no busy time. */
export async function calendarBusy(
	calendar: CalendarClient | undefined,
	settings: StudioSettings,
	from: Date,
	to: Date
): Promise<Interval[]> {
	if (!calendar?.enabled || settings.gcalBusyCalendarIds.length === 0) return [];
	try {
		return await calendar.busy(settings.gcalBusyCalendarIds, from, to);
	} catch (e) {
		console.error('Failed to read Google Calendar busy times', e);
		return [];
	}
}

/** The description deliberately omits the family's manage link: calendar viewers must not get it. */
export function lessonEvent(
	b: AdminBooking,
	settings: StudioSettings,
	appUrl: string
): CalendarEventInput {
	const lines = [`Booked by ${b.accountName} (${b.accountEmail})`];
	if (b.note) lines.push(b.note);
	lines.push(`Manage in SessionX: ${appUrl}/admin/lessons`);
	return {
		summary: `${b.lessonTypeName} – ${b.studentName}`,
		description: lines.join('\n'),
		start: b.startsAt,
		end: b.endsAt,
		timeZone: settings.timezone
	};
}

export async function addLessonToCalendar(
	deps: { store: AppStore; calendar?: CalendarClient; appUrl: string },
	booking: AdminBooking,
	settings: StudioSettings
): Promise<void> {
	const { store, calendar, appUrl } = deps;
	const calendarId = settings.gcalWriteCalendarId;
	if (!calendar?.enabled || !calendarId || booking.gcalEventId) return;
	try {
		const eventId = await calendar.createEvent(calendarId, lessonEvent(booking, settings, appUrl));
		await store.setCalendarEventId(booking.id, eventId);
	} catch (e) {
		console.error('Failed to add lesson to Google Calendar', e);
	}
}

export async function removeLessonFromCalendar(
	deps: { store: AppStore; calendar?: CalendarClient },
	booking: AdminBooking,
	settings: StudioSettings
): Promise<void> {
	const { store, calendar } = deps;
	const calendarId = settings.gcalWriteCalendarId;
	if (!booking.gcalEventId || !calendar?.enabled || !calendarId) return;
	try {
		await calendar.deleteEvent(calendarId, booking.gcalEventId);
		await store.setCalendarEventId(booking.id, null);
	} catch (e) {
		console.error('Failed to remove lesson from Google Calendar', e);
	}
}
