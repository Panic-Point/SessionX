import { DateTime } from 'luxon';
import { BOOKING_FUNNEL, USAGE_PAGES, type UsagePage } from '../usage-pages';
import type { AccountWithStudents, UsageEvent } from './store/types';

export const REPORT_DAYS = [7, 30, 90] as const;
export type ReportDays = (typeof REPORT_DAYS)[number];

/** Events the report reads at most; past this it says the numbers are incomplete. */
export const REPORT_EVENT_LIMIT = 20000;
/** No event for this long while the site is live usually means tracking stopped working. */
export const STALE_AFTER_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAU_DAYS = 30;

export function parseReportDays(value: string | null): ReportDays {
	const n = Number(value);
	return (REPORT_DAYS as readonly number[]).includes(n) ? (n as ReportDays) : 30;
}

/** The window the report needs: the period, and always the last 30 days for monthly actives. */
export function reportWindow(days: ReportDays, timezone: string, now: Date) {
	const periodFrom = DateTime.fromJSDate(now, { zone: timezone })
		.startOf('day')
		.minus({ days: days - 1 })
		.toJSDate();
	const mauFrom = new Date(now.getTime() - MAU_DAYS * DAY_MS);
	return { periodFrom, fetchFrom: periodFrom < mauFrom ? periodFrom : mauFrom };
}

export function formatDuration(ms: number): string {
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
	return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

function pct(part: number, whole: number): number | null {
	return whole > 0 ? Math.round((part / whole) * 100) : null;
}

export interface UsageReportInput {
	events: UsageEvent[];
	truncated: boolean;
	lastEventAt: Date | null;
	accounts: AccountWithStudents[];
	days: ReportDays;
	timezone: string;
	now: Date;
}

/** Everything the Usage tab shows, computed from raw events in the studio's timezone. */
export function buildUsageReport(input: UsageReportInput) {
	const { events, accounts, days, timezone, now } = input;
	const { periodFrom } = reportWindow(days, timezone, now);
	const dayKey = (at: Date) => DateTime.fromJSDate(at, { zone: timezone }).toISODate()!;
	const label = (at: Date) =>
		DateTime.fromJSDate(at, { zone: timezone }).setLocale('en-US').toFormat("LLL d 'at' h:mm a");

	const families = accounts.filter((a) => a.role === 'client' && !a.deleted);
	const familyIds = new Set(families.map((a) => a.id));
	const inPeriod = events.filter((e) => e.occurredAt >= periodFrom);
	const isActivity = (e: UsageEvent) =>
		e.accountId !== null && familyIds.has(e.accountId) && e.kind !== 'sign_in_failed';

	// ---- daily actives ----
	const dayKeys: string[] = [];
	for (let i = days - 1; i >= 0; i--) {
		dayKeys.push(
			DateTime.fromJSDate(now, { zone: timezone }).startOf('day').minus({ days: i }).toISODate()!
		);
	}
	const daily = new Map(
		dayKeys.map((k) => [k, { families: new Set<string>(), visits: new Set<string>() }])
	);
	for (const e of inPeriod) {
		const d = daily.get(dayKey(e.occurredAt));
		if (!d) continue;
		if (isActivity(e)) d.families.add(e.accountId!);
		if (e.visitId && (e.kind === 'page_view' || e.kind === 'page_time')) d.visits.add(e.visitId);
	}
	const dailyRows = dayKeys.map((k) => ({
		date: k,
		label: DateTime.fromISO(k).setLocale('en-US').toFormat('ccc LLL d'),
		families: daily.get(k)!.families.size,
		visits: daily.get(k)!.visits.size
	}));
	const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

	const mauFrom = new Date(now.getTime() - MAU_DAYS * DAY_MS);
	const mauSet = new Set(
		events.filter((e) => e.occurredAt >= mauFrom && isActivity(e)).map((e) => e.accountId!)
	);
	// Stickiness always compares the last 30 days' average DAU to MAU, whatever the period.
	const last30 = new Map<string, Set<string>>();
	for (const e of events) {
		if (e.occurredAt < mauFrom || !isActivity(e)) continue;
		const k = dayKey(e.occurredAt);
		if (!last30.has(k)) last30.set(k, new Set());
		last30.get(k)!.add(e.accountId!);
	}
	const avgDau30 = [...last30.values()].reduce((a, s) => a + s.size, 0) / MAU_DAYS;

	// ---- views and time per page ----
	const views = inPeriod.filter((e) => e.kind === 'page_view' || e.kind === 'page_time');
	const byRoute = new Map<string, { views: number; visits: Set<string>; ms: number }>();
	for (const e of views) {
		if (!e.route) continue;
		const r = byRoute.get(e.route) ?? { views: 0, visits: new Set(), ms: 0 };
		if (e.kind === 'page_view') r.views++;
		if (e.visitId) r.visits.add(e.visitId);
		r.ms += e.durationMs ?? 0;
		byRoute.set(e.route, r);
	}
	const known = new Map(USAGE_PAGES.map((p) => [p.route, p]));
	const pageOf = (route: string): UsagePage =>
		known.get(route) ?? { route, label: route, area: 'Other' };
	const pages = [...byRoute.entries()]
		.map(([route, r]) => ({
			...pageOf(route),
			views: r.views,
			visits: r.visits.size,
			totalMs: r.ms,
			totalLabel: formatDuration(r.ms),
			avgLabel: formatDuration(r.views ? r.ms / r.views : r.ms)
		}))
		.sort((a, b) => b.totalMs - a.totalMs || b.views - a.views);
	const maxPageMs = Math.max(0, ...pages.map((p) => p.totalMs));

	const allVisits = new Set(views.map((e) => e.visitId).filter((v): v is string => v !== null));
	const signedInVisits = new Set(
		views.filter((e) => e.accountId && e.visitId).map((e) => e.visitId!)
	);

	// ---- booking funnel: visits that reached each step ----
	const funnelCounts = BOOKING_FUNNEL.map((route) => byRoute.get(route)?.visits.size ?? 0);
	const funnel = BOOKING_FUNNEL.map((route, i) => ({
		route,
		label: pageOf(route).label,
		visits: funnelCounts[i],
		pctOfFirst: pct(funnelCounts[i], funnelCounts[0]),
		pctOfPrev: i === 0 ? null : pct(funnelCounts[i], funnelCounts[i - 1])
	}));

	// ---- features used / not used ----
	const features = USAGE_PAGES.map((p) => ({
		...p,
		views: byRoute.get(p.route)?.views ?? 0,
		visits: byRoute.get(p.route)?.visits.size ?? 0
	}));

	// ---- sign-ins ----
	const signIns = inPeriod.filter((e) => e.kind === 'sign_in');
	const failed = inPeriod.filter((e) => e.kind === 'sign_in_failed').length;
	const signedInFamilies = new Set(
		signIns.map((e) => e.accountId).filter((id) => id && familyIds.has(id))
	);
	const activeFamilies = new Set(inPeriod.filter(isActivity).map((e) => e.accountId!));

	// ---- per family ----
	const perFamily = new Map<
		string,
		{ last: Date; days: Set<string>; views: number; ms: number; signIns: number }
	>();
	for (const e of events) {
		if (!isActivity(e)) continue;
		const f = perFamily.get(e.accountId!) ?? {
			last: e.occurredAt,
			days: new Set(),
			views: 0,
			ms: 0,
			signIns: 0
		};
		if (e.occurredAt > f.last) f.last = e.occurredAt;
		if (e.occurredAt >= periodFrom) {
			f.days.add(dayKey(e.occurredAt));
			if (e.kind === 'page_view') f.views++;
			if (e.kind === 'sign_in') f.signIns++;
			f.ms += e.durationMs ?? 0;
		}
		perFamily.set(e.accountId!, f);
	}
	const familyRows = families
		.map((a) => {
			const f = perFamily.get(a.id);
			return {
				id: a.id,
				name: a.name,
				lastActive: f?.last ?? null,
				lastActiveLabel: f ? label(f.last) : null,
				activeDays: f?.days.size ?? 0,
				views: f?.views ?? 0,
				signIns: f?.signIns ?? 0,
				timeLabel: formatDuration(f?.ms ?? 0)
			};
		})
		.sort(
			(a, b) =>
				(b.lastActive?.getTime() ?? -1) - (a.lastActive?.getTime() ?? -1) ||
				a.name.localeCompare(b.name)
		)
		.map(({ lastActive: _, ...row }) => row);

	// ---- errors ----
	const errorsByRoute = new Map<string, { count: number; last: UsageEvent }>();
	for (const e of inPeriod) {
		if (e.kind !== 'error') continue;
		const key = e.route ?? '(no page)';
		const r = errorsByRoute.get(key);
		if (!r) errorsByRoute.set(key, { count: 1, last: e });
		else {
			r.count++;
			if (e.occurredAt > r.last.occurredAt) r.last = e;
		}
	}
	const errors = [...errorsByRoute.entries()]
		.map(([route, r]) => ({
			route,
			label: route === '(no page)' ? route : pageOf(route).label,
			count: r.count,
			lastLabel: label(r.last.occurredAt),
			lastDetail: r.last.detail ?? ''
		}))
		.sort((a, b) => b.count - a.count);

	const lastAt = input.lastEventAt;
	return {
		days,
		periodLabel: `${DateTime.fromJSDate(periodFrom, { zone: timezone }).setLocale('en-US').toFormat('LLL d')} to today`,
		tracking: {
			lastEventLabel: lastAt ? label(lastAt) : null,
			stale: lastAt !== null && now.getTime() - lastAt.getTime() > STALE_AFTER_DAYS * DAY_MS,
			truncated: input.truncated
		},
		summary: {
			dauToday: dailyRows[dailyRows.length - 1]?.families ?? 0,
			avgDau: Math.round(avg(dailyRows.map((d) => d.families)) * 10) / 10,
			mau: mauSet.size,
			stickinessPct: pct(avgDau30, mauSet.size),
			visits: allVisits.size,
			signedInVisits: signedInVisits.size,
			guestVisits: allVisits.size - signedInVisits.size,
			pageViews: views.filter((e) => e.kind === 'page_view').length,
			totalTimeLabel: formatDuration(views.reduce((a, e) => a + (e.durationMs ?? 0), 0)),
			avgVisitLabel: formatDuration(
				allVisits.size ? views.reduce((a, e) => a + (e.durationMs ?? 0), 0) / allVisits.size : 0
			)
		},
		daily: dailyRows,
		maxDailyFamilies: Math.max(0, ...dailyRows.map((d) => d.families)),
		maxDailyVisits: Math.max(0, ...dailyRows.map((d) => d.visits)),
		signIns: {
			succeeded: signIns.length,
			failed,
			successPct: pct(signIns.length, signIns.length + failed),
			familiesSignedIn: signedInFamilies.size,
			familiesActive: activeFamilies.size,
			familiesTotal: families.length,
			activePct: pct(activeFamilies.size, families.length)
		},
		pages: pages.map((p) => ({
			...p,
			barPct: maxPageMs ? Math.round((p.totalMs / maxPageMs) * 100) : 0
		})),
		funnel,
		features,
		families: familyRows,
		errors
	};
}

export type UsageReport = ReturnType<typeof buildUsageReport>;
