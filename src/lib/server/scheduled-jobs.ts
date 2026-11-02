import { syncLessonsToCalendar } from './calendar/sync';
import type { CalendarClient } from './calendar/types';
import { topUpSeries } from './series-service';
import type { AppStore } from './store/types';

/**
 * Subrequests (Supabase, Google) a run may spend on series and calendar work. The Workers free plan
 * allows 50 per request; the rest covers the fixed reads (settings, expiry, series lists, Google
 * token, lessons to sync, old usage events) with room to spare.
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
	/** Usage events past USAGE_RETENTION_DAYS deleted; null when the delete failed (logged). */
	usagePurged: number | null;
}

/** Usage events are kept a little over a year, enough for year-on-year comparisons. */
export const USAGE_RETENTION_DAYS = 400;

export async function runScheduledJobs(
	deps: { store: AppStore; calendar?: CalendarClient; appUrl: string },
	now: Date
): Promise<ScheduledJobsResult> {
	// Touches the DB first, which keeps the free Supabase project awake.
	const settings = await deps.store.getSettings();
	const expired = await deps.store.expirePendingBookings(now);
	const usagePurged = await purgeOldUsage(deps.store, now);
	const topUp = await topUpSeries(deps, now, CRON_SUBREQUEST_BUDGET);
	// Catches lessons a busy request left off the calendar, with whatever budget is left.
	const left = CRON_SUBREQUEST_BUDGET - topUp.subrequests;
	const synced = await syncLessonsToCalendar(deps, settings, now, Math.floor(left / 2));
	return {
		expired,
		seriesToppedUp: topUp.series,
		lessonsAdded: topUp.lessonsAdded,
		seriesDeferred: topUp.deferred,
		calendarAdded: synced.added,
		usagePurged
	};
}

/** A failed purge is logged but must not stop the booking jobs; it is retried on the next run. */
async function purgeOldUsage(store: AppStore, now: Date): Promise<number | null> {
	try {
		return await store.deleteUsageEventsBefore(
			new Date(now.getTime() - USAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000)
		);
	} catch (error) {
		console.error('cron: deleting old usage events failed', error);
		return null;
	}
}
