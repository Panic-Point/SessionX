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

/** True only when a new event was created and saved on the booking. */
export async function addLessonToCalendar(
	deps: { store: AppStore; calendar?: CalendarClient; appUrl: string },
	booking: AdminBooking,
	settings: StudioSettings
): Promise<boolean> {
	const { store, calendar, appUrl } = deps;
	const calendarId = settings.gcalWriteCalendarId;
	if (!calendar?.enabled || !calendarId || booking.gcalEventId) return false;
	try {
		const eventId = await calendar.createEvent(calendarId, lessonEvent(booking, settings, appUrl));
		await store.setCalendarEventId(booking.id, eventId);
		return true;
	} catch (e) {
		console.error('Failed to add lesson to Google Calendar', e);
		return false;
	}
}

/**
 * Lessons added per click. Each costs two subrequests (Google + database), which keeps one request
 * well under the Cloudflare Workers free plan's 50-subrequest limit.
 */
export const SYNC_BATCH_SIZE = 15;

export interface SyncResult {
	added: number;
	failed: number;
	/** Upcoming approved lessons still missing from the calendar after this run. */
	remaining: number;
}

/**
 * Adds upcoming approved lessons that have no calendar event yet, such as ones booked before the
 * calendar was connected. Past lessons are left alone. Safe to repeat: synced lessons are skipped.
 */
export async function syncLessonsToCalendar(
	deps: { store: AppStore; calendar?: CalendarClient; appUrl: string },
	settings: StudioSettings,
	now: Date,
	limit = SYNC_BATCH_SIZE
): Promise<SyncResult> {
	if (!deps.calendar?.enabled || !settings.gcalWriteCalendarId || limit <= 0) {
		return { added: 0, failed: 0, remaining: 0 };
	}
	const lessons = await deps.store.listBookings({
		statuses: ['approved'],
		from: now,
		order: 'asc'
	});
	const missing = lessons.filter((b) => !b.gcalEventId);
	const batch = missing.slice(0, limit);
	let added = 0;
	for (const b of batch) if (await addLessonToCalendar(deps, b, settings)) added++;
	return { added, failed: batch.length - added, remaining: missing.length - added };
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
