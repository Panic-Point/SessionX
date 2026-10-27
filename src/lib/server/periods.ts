import { DateTime } from 'luxon';

export type PeriodKind = 'week' | 'month' | 'custom';

/** Query params that select a period, e.g. { period: 'week', date: '2026-11-02' }. */
export type PeriodParams = Record<string, string>;

export interface Period {
	kind: PeriodKind;
	/** "Week of Nov 2, 2026", "November 2026" or "Nov 2 – Nov 20, 2026". */
	label: string;
	/** Start of the first studio-local day (inclusive) and of the day after the last (exclusive). */
	range: { from: Date; to: Date } | null;
	/** Set when the range cannot be shown, e.g. a custom start after its end. */
	error: string | null;
	/** Set when the range was shortened to the maximum length. */
	note: string | null;
	/** yyyy-MM-dd values for the custom range inputs. */
	fromInput: string;
	toInput: string;
	prev: PeriodParams | null;
	current: PeriodParams | null;
	next: PeriodParams | null;
}

export const MAX_RANGE_DAYS = 366;
export const RANGE_ORDER_ERROR = 'The start date must be on or before the end date.';
export const RANGE_CAPPED_NOTE = `Showing the first ${MAX_RANGE_DAYS} days of the range.`;

const DAY = 'yyyy-MM-dd';
const MONTH = 'yyyy-MM';

function parse(value: string | null, format: string, zone: string): DateTime | null {
	if (!value) return null;
	const parsed = DateTime.fromFormat(value, format, { zone });
	// Keep years sane so a hand-edited URL cannot ask for year 0 or 275760.
	return parsed.isValid && parsed.year >= 1970 && parsed.year <= 9999 ? parsed : null;
}

function bounds(first: DateTime, last: DateTime): { from: Date; to: Date } {
	return {
		from: first.startOf('day').toJSDate(),
		to: last.plus({ days: 1 }).startOf('day').toJSDate()
	};
}

function short(d: DateTime): string {
	return d.setLocale('en-US').toFormat('LLL d');
}

function long(d: DateTime): string {
	return d.setLocale('en-US').toFormat('LLL d, yyyy');
}

export function rangeLabel(first: DateTime, last: DateTime): string {
	if (first.hasSame(last, 'day')) return long(first);
	if (first.year === last.year) return `${short(first)} – ${long(last)}`;
	return `${long(first)} – ${long(last)}`;
}

/** The period params of a URL, to keep on links that change something else on the page. */
export function periodQuery(params: URLSearchParams): PeriodParams {
	const kept: PeriodParams = {};
	if (!params.get('period')) return kept;
	for (const name of ['period', 'date', 'from', 'to']) {
		const value = params.get(name);
		if (value) kept[name] = value;
	}
	return kept;
}

/**
 * Reads ?period=week&date=, ?period=month&date= or ?period=custom&from=&to= as studio-local
 * dates in `timezone`. Returns null without a known `period`, so the caller keeps its default view.
 * Never throws: bad dates fall back to the current week or month.
 */
export function parsePeriod(params: URLSearchParams, timezone: string, now: Date): Period | null {
	const kind = params.get('period');
	const today = DateTime.fromJSDate(now, { zone: timezone }).startOf('day');

	if (kind === 'week') {
		const day = parse(params.get('date'), DAY, timezone) ?? today;
		const monday = day.startOf('week');
		const sunday = monday.plus({ days: 6 });
		const at = (d: DateTime) => ({ period: 'week', date: d.toFormat(DAY) });
		return {
			kind,
			label: `Week of ${long(monday)}`,
			range: bounds(monday, sunday),
			error: null,
			note: null,
			fromInput: monday.toFormat(DAY),
			toInput: sunday.toFormat(DAY),
			prev: at(monday.minus({ weeks: 1 })),
			current: { period: 'week' },
			next: at(monday.plus({ weeks: 1 }))
		};
	}

	if (kind === 'month') {
		const first = (parse(params.get('date'), MONTH, timezone) ?? today).startOf('month');
		const last = first.endOf('month');
		const at = (d: DateTime) => ({ period: 'month', date: d.toFormat(MONTH) });
		return {
			kind,
			label: first.setLocale('en-US').toFormat('LLLL yyyy'),
			range: bounds(first, last),
			error: null,
			note: null,
			fromInput: first.toFormat(DAY),
			toInput: last.toFormat(DAY),
			prev: at(first.minus({ months: 1 })),
			current: { period: 'month' },
			next: at(first.plus({ months: 1 }))
		};
	}

	if (kind === 'custom') {
		let first = parse(params.get('from'), DAY, timezone);
		let last = parse(params.get('to'), DAY, timezone);
		if (!first || !last) {
			// A missing or bad date falls back to the current week.
			first = today.startOf('week');
			last = first.plus({ days: 6 });
		}
		const base = {
			kind,
			fromInput: first.toFormat(DAY),
			toInput: last.toFormat(DAY),
			prev: null,
			current: null,
			next: null
		} as const;
		if (first > last) {
			return {
				...base,
				label: rangeLabel(first, last),
				range: null,
				error: RANGE_ORDER_ERROR,
				note: null
			};
		}
		let note: string | null = null;
		const maxLast = first.plus({ days: MAX_RANGE_DAYS - 1 });
		if (last > maxLast) {
			last = maxLast;
			note = RANGE_CAPPED_NOTE;
		}
		return {
			...base,
			toInput: last.toFormat(DAY),
			label: rangeLabel(first, last),
			range: bounds(first, last),
			error: null,
			note
		};
	}

	return null;
}
