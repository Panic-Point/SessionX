import { requireAdmin } from '#lib/server/admin-actions.ts';
import { getStore } from '#lib/server/context.ts';
import {
	buildUsageReport,
	parseReportDays,
	REPORT_EVENT_LIMIT,
	reportWindow
} from '#lib/server/usage-report.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireAdmin(locals.account);
	const store = getStore();
	const now = new Date();
	const days = parseReportDays(url.searchParams.get('days'));
	const { timezone } = await store.getSettings();
	const { fetchFrom } = reportWindow(days, timezone, now);
	// A failed read throws to the error page rather than showing zeros that look like no usage.
	const [page, lastEventAt, accounts] = await Promise.all([
		store.listUsageEvents(fetchFrom, new Date(now.getTime() + 1), REPORT_EVENT_LIMIT),
		store.lastUsageEventAt(),
		store.listAccounts()
	]);
	return {
		report: buildUsageReport({
			events: page.events,
			truncated: page.truncated,
			lastEventAt,
			accounts,
			days,
			timezone,
			now
		})
	};
};
