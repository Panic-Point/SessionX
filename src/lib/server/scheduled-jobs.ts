import type { AppStore } from './store/types';

export interface ScheduledJobsResult {
	expired: number;
}

export async function runScheduledJobs(store: AppStore, now: Date): Promise<ScheduledJobsResult> {
	// Touches the DB first, which keeps the free Supabase project awake.
	await store.getSettings();
	const expired = await store.expirePendingBookings(now);
	return { expired };
}
