import { syncLessonsToCalendar } from './calendar/sync';
import type { CalendarClient } from './calendar/types';
import { topUpSeries } from './series-service';
import type { AppStore } from './store/types';

/**
 * Subrequests (Supabase, Google) a run may spend on series and calendar work. The Workers free plan
 * allows 50 per request; the rest covers the fixed reads (settings, expiry, series lists, Google
 * token, lessons to sync) with room to spare.
 */
export const CRON_SUBREQUEST_BUDGET = 38;

export interface ScheduledJobsResult {
	expired: number;
	/** Recurring series that had new dates considered. */
	seriesToppedUp: number;
	/** Lessons created for recurring series. */
	lessonsAdded: number;
	/** Series due a top-up that wait for the next run to stay under the subrequest limit. */
	seriesDeferred: number;
	/** Upcoming lessons put on Google Calendar that weren't there yet. */
	calendarAdded: number;
}

export async function runScheduledJobs(
	deps: { store: AppStore; calendar?: CalendarClient; appUrl: string },
	now: Date
): Promise<ScheduledJobsResult> {
	// Touches the DB first, which keeps the free Supabase project awake.
	const settings = await deps.store.getSettings();
	const expired = await deps.store.expirePendingBookings(now);
	const topUp = await topUpSeries(deps, now, CRON_SUBREQUEST_BUDGET);
	// Catches lessons a busy request left off the calendar, with whatever budget is left.
	const left = CRON_SUBREQUEST_BUDGET - topUp.subrequests;
	const synced = await syncLessonsToCalendar(deps, settings, now, Math.floor(left / 2));
	return {
		expired,
		seriesToppedUp: topUp.series,
		lessonsAdded: topUp.lessonsAdded,
		seriesDeferred: topUp.deferred,
		calendarAdded: synced.added
	};
}
