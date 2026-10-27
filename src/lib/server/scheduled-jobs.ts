import type { CalendarClient } from './calendar/types';
import { topUpSeries } from './series-service';
import type { AppStore } from './store/types';

export interface ScheduledJobsResult {
	expired: number;
	/** Recurring series that had new dates considered. */
	seriesToppedUp: number;
	/** Lessons created for recurring series. */
	lessonsAdded: number;
}

export async function runScheduledJobs(
	deps: { store: AppStore; calendar?: CalendarClient; appUrl: string },
	now: Date
): Promise<ScheduledJobsResult> {
	// Touches the DB first, which keeps the free Supabase project awake.
	await deps.store.getSettings();
	const expired = await deps.store.expirePendingBookings(now);
	const topUp = await topUpSeries(deps, now);
	return { expired, seriesToppedUp: topUp.series, lessonsAdded: topUp.lessonsAdded };
}
