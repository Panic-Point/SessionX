import { describe, expect, it } from 'vitest';
import type { AccountWithStudents, UsageEvent, UsageEventKind } from './store/types';
import {
	buildUsageReport,
	formatDuration,
	parseReportDays,
	reportWindow,
	type ReportDays
} from './usage-report';

const TZ = 'America/Los_Angeles';
// 10:00 on Sunday Nov 1 in Los Angeles.
const NOW = new Date('2026-11-01T17:00:00Z');
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function account(
	id: string,
	name: string,
	extra: Partial<AccountWithStudents> = {}
): AccountWithStudents {
	return {
		id,
		name,
		email: `${id}@x.test`,
		role: 'client',
		adminNotes: '',
		deleted: false,
		students: [],
		...extra
	};
}

const ACCOUNTS = [
	account('a', 'Alma'),
	account('b', 'Ben'),
	account('c', 'Cleo'),
	account('gone', 'Gone', { deleted: true }),
	account('admin', 'Brenda', { role: 'admin' })
];

let n = 0;
function ev(kind: UsageEventKind, agoMs: number, extra: Partial<UsageEvent> = {}): UsageEvent {
	return {
		id: String(n++),
		kind,
		occurredAt: new Date(NOW.getTime() - agoMs),
		accountId: null,
		visitId: null,
		route: null,
		durationMs: null,
		detail: null,
		...extra
	};
}

function view(
	agoMs: number,
	route: string,
	visitId: string,
	ms: number,
	accountId: string | null = null
) {
	return ev('page_view', agoMs, { route, visitId, durationMs: ms, accountId });
}

function report(events: UsageEvent[], days: ReportDays = 7, lastEventAt: Date | null = NOW) {
	return buildUsageReport({
		events,
		truncated: false,
		lastEventAt,
		accounts: ACCOUNTS,
		days,
		timezone: TZ,
		now: NOW
	});
}

describe('helpers', () => {
	it('parses the period and formats durations', () => {
		expect(parseReportDays('7')).toBe(7);
		expect(parseReportDays('90')).toBe(90);
		expect(parseReportDays('12')).toBe(30);
		expect(parseReportDays(null)).toBe(30);
		expect(formatDuration(4_400)).toBe('4s');
		expect(formatDuration(125_000)).toBe('2m 05s');
		expect(formatDuration(2 * HOUR + 3 * 60_000)).toBe('2h 03m');
	});

	it('always reads at least the last 30 days, for monthly actives', () => {
		const w = reportWindow(7, TZ, NOW);
		expect(w.periodFrom).toEqual(new Date('2026-10-26T07:00:00Z'));
		expect(w.fetchFrom).toEqual(new Date(NOW.getTime() - 30 * DAY));
		expect(reportWindow(90, TZ, NOW).fetchFrom).toEqual(reportWindow(90, TZ, NOW).periodFrom);
	});
});

describe('buildUsageReport', () => {
	it('counts daily and monthly active families in the studio timezone', () => {
		const r = report([
			view(1 * HOUR, '/account/(tabs)', 'v-a-today', 1000, 'a'),
			view(2 * HOUR, '/account/(tabs)', 'v-b-today', 1000, 'b'),
			// 11pm Saturday in LA is still yesterday there, though it is Sunday in UTC.
			view(11 * HOUR, '/account/(tabs)', 'v-a-sat', 1000, 'a'),
			// Older than the 7-day period, inside the 30-day MAU window.
			view(20 * DAY, '/account/(tabs)', 'v-c-old', 1000, 'c'),
			// The admin and deleted accounts never count.
			view(1 * HOUR, '/', 'v-admin', 1000, 'admin'),
			view(1 * HOUR, '/', 'v-gone', 1000, 'gone')
		]);
		expect(r.summary.dauToday).toBe(2);
		expect(r.daily.at(-1)).toMatchObject({ date: '2026-11-01', families: 2 });
		expect(r.daily.at(-2)).toMatchObject({ date: '2026-10-31', families: 1 });
		expect(r.daily).toHaveLength(7);
		expect(r.summary.avgDau).toBe(Math.round((3 / 7) * 10) / 10);
		expect(r.summary.mau).toBe(3);
		// 4 family-days over 30 days, against 3 monthly actives.
		expect(r.summary.stickinessPct).toBe(Math.round((4 / 30 / 3) * 100));
		expect(r.signIns).toMatchObject({ familiesActive: 2, familiesTotal: 3, activePct: 67 });
	});

	it('works out sign-in success and where time goes', () => {
		const r = report([
			ev('sign_in', HOUR, { accountId: 'a' }),
			ev('sign_in', 2 * HOUR, { accountId: 'b' }),
			ev('sign_in', 3 * HOUR, { accountId: 'b' }),
			ev('sign_in_failed', HOUR, { route: '/login' }),
			view(HOUR, '/book', 'v1', 60_000),
			ev('page_time', HOUR - 1, { route: '/book', visitId: 'v1', durationMs: 30_000 }),
			view(HOUR, '/account/(tabs)/repertoire', 'v2', 20_000, 'a'),
			view(HOUR, '/somewhere/new', 'v3', 1_000)
		]);
		expect(r.signIns).toMatchObject({
			succeeded: 3,
			failed: 1,
			successPct: 75,
			familiesSignedIn: 2
		});
		expect(r.pages.map((p) => [p.label, p.views, p.totalLabel, p.avgLabel, p.barPct])).toEqual([
			['Book: choose a time', 1, '1m 30s', '1m 30s', 100],
			['Repertoire', 1, '20s', '20s', 22],
			['/somewhere/new', 1, '1s', '1s', 1]
		]);
		expect(r.summary).toMatchObject({ visits: 3, signedInVisits: 1, guestVisits: 2, pageViews: 3 });
	});

	it('shows the booking funnel and unused features', () => {
		const r = report([
			view(HOUR, '/book', 'v1', 1),
			view(HOUR, '/book', 'v2', 1),
			view(HOUR, '/book', 'v3', 1),
			view(HOUR, '/book', 'v4', 1),
			view(HOUR, '/book/details', 'v1', 1),
			view(HOUR, '/book/details', 'v2', 1),
			view(HOUR, '/book/requested', 'v1', 1)
		]);
		expect(r.funnel.map((s) => [s.visits, s.pctOfFirst, s.pctOfPrev])).toEqual([
			[4, 100, null],
			[2, 50, 50],
			[1, 25, 50]
		]);
		const repertoire = r.features.find((f) => f.route === '/account/(tabs)/repertoire');
		expect(repertoire).toMatchObject({ views: 0 });
		expect(r.features.find((f) => f.route === '/book')).toMatchObject({ views: 4, visits: 4 });
	});

	it('lists every family, most recently active first, including ones not seen lately', () => {
		const r = report([
			view(3 * HOUR, '/account/(tabs)', 'v1', 5_000, 'b'),
			view(10 * DAY, '/account/(tabs)', 'v2', 5_000, 'a'),
			ev('sign_in', 3 * HOUR, { accountId: 'b' })
		]);
		expect(r.families.map((f) => [f.name, f.activeDays, f.views, f.signIns])).toEqual([
			['Ben', 1, 1, 1],
			// Active 10 days ago: outside the 7-day period, but its last visit still shows.
			['Alma', 0, 0, 0],
			['Cleo', 0, 0, 0]
		]);
		expect(r.families[1].lastActiveLabel).toBe('Oct 22 at 10:00 AM');
		expect(r.families[2].lastActiveLabel).toBeNull();
	});

	it('groups errors by page with the latest detail', () => {
		const r = report([
			ev('error', 2 * HOUR, { route: '/book/details', detail: '500 Error: old' }),
			ev('error', HOUR, { route: '/book/details', detail: '500 Error: new' }),
			ev('error', HOUR, { route: null, detail: '500 Error: x' })
		]);
		expect(r.errors.map((e) => [e.label, e.count, e.lastDetail])).toEqual([
			['Book: details', 2, '500 Error: new'],
			['(no page)', 1, '500 Error: x']
		]);
	});

	it('flags when tracking has gone quiet or never started', () => {
		expect(report([], 7, null).tracking).toMatchObject({ lastEventLabel: null, stale: false });
		expect(report([], 7, new Date(NOW.getTime() - 4 * DAY)).tracking.stale).toBe(true);
		expect(report([], 7, new Date(NOW.getTime() - DAY)).tracking.stale).toBe(false);
		const empty = report([], 7);
		expect(empty.summary).toMatchObject({ dauToday: 0, mau: 0, stickinessPct: null, visits: 0 });
		expect(empty.signIns.successPct).toBeNull();
	});
});
