import { describe, expect, it } from 'vitest';
import { RANGE_CAPPED_NOTE, RANGE_ORDER_ERROR, parsePeriod, periodQuery } from './periods';

const TZ = 'America/New_York';
// Wednesday, October 28, 2026, mid-afternoon in New York.
const NOW = new Date('2026-10-28T19:00:00Z');

function period(query: string, now = NOW) {
	return parsePeriod(new URLSearchParams(query), TZ, now);
}

const iso = (d: Date | undefined) => d?.toISOString();

describe('parsePeriod', () => {
	it('returns null without a known period, keeping the default view', () => {
		expect(period('')).toBeNull();
		expect(period('range=past')).toBeNull();
		expect(period('period=year')).toBeNull();
	});

	it('week is Monday to Sunday in studio time', () => {
		const p = period('period=week&date=2026-11-04')!;
		expect(p.label).toBe('Week of Nov 2, 2026');
		// EST (UTC-5) after the Nov 1 DST change.
		expect(iso(p.range?.from)).toBe('2026-11-02T05:00:00.000Z');
		expect(iso(p.range?.to)).toBe('2026-11-09T05:00:00.000Z');
		expect(p.prev).toEqual({ period: 'week', date: '2026-10-26' });
		expect(p.next).toEqual({ period: 'week', date: '2026-11-09' });
		expect(p.current).toEqual({ period: 'week' });
	});

	it('week across a DST change is 7 local days, not 7 x 24 hours', () => {
		// Oct 26 – Nov 1, 2026: clocks go back on Sunday Nov 1.
		const p = period('period=week&date=2026-11-01')!;
		expect(p.label).toBe('Week of Oct 26, 2026');
		expect(iso(p.range?.from)).toBe('2026-10-26T04:00:00.000Z');
		expect(iso(p.range?.to)).toBe('2026-11-02T05:00:00.000Z');
		// Spring forward: Mar 8, 2027 is a Monday, clocks go forward Mar 14.
		const spring = period('period=week&date=2027-03-14')!;
		expect(iso(spring.range?.from)).toBe('2027-03-08T05:00:00.000Z');
		expect(iso(spring.range?.to)).toBe('2027-03-15T04:00:00.000Z');
	});

	it('week across a month and year boundary', () => {
		const p = period('period=week&date=2027-01-01')!;
		expect(p.label).toBe('Week of Dec 28, 2026');
		expect(p.fromInput).toBe('2026-12-28');
		expect(p.toInput).toBe('2027-01-03');
		expect(p.next).toEqual({ period: 'week', date: '2027-01-04' });
	});

	it('bad or missing week date falls back to the current week', () => {
		for (const q of ['period=week', 'period=week&date=nope', 'period=week&date=2026-02-30']) {
			expect(period(q)!.label).toBe('Week of Oct 26, 2026');
		}
		// Late Sunday night in New York is already Monday in UTC.
		const sundayNight = new Date('2026-11-02T04:30:00Z');
		expect(period('period=week', sundayNight)!.label).toBe('Week of Oct 26, 2026');
	});

	it('month is the calendar month in studio time', () => {
		const p = period('period=month&date=2026-11')!;
		expect(p.label).toBe('November 2026');
		expect(iso(p.range?.from)).toBe('2026-11-01T04:00:00.000Z');
		expect(iso(p.range?.to)).toBe('2026-12-01T05:00:00.000Z');
		expect(p.prev).toEqual({ period: 'month', date: '2026-10' });
		expect(p.next).toEqual({ period: 'month', date: '2026-12' });
		expect(period('period=month&date=2026-12')!.next).toEqual({ period: 'month', date: '2027-01' });
	});

	it('bad month falls back to the current month', () => {
		for (const q of ['period=month', 'period=month&date=2026-13', 'period=month&date=0000-01']) {
			expect(period(q)!.label).toBe('October 2026');
		}
	});

	it('custom range includes both days', () => {
		const p = period('period=custom&from=2026-11-02&to=2026-11-20')!;
		expect(p.label).toBe('Nov 2 – Nov 20, 2026');
		expect(iso(p.range?.from)).toBe('2026-11-02T05:00:00.000Z');
		expect(iso(p.range?.to)).toBe('2026-11-21T05:00:00.000Z');
		expect(p.error).toBeNull();
		expect(p.prev).toBeNull();
		expect(period('period=custom&from=2026-12-30&to=2027-01-02')!.label).toBe(
			'Dec 30, 2026 – Jan 2, 2027'
		);
		expect(period('period=custom&from=2026-11-02&to=2026-11-02')!.label).toBe('Nov 2, 2026');
	});

	it('custom range with start after end is an error with no range', () => {
		const p = period('period=custom&from=2026-11-20&to=2026-11-02')!;
		expect(p.error).toBe(RANGE_ORDER_ERROR);
		expect(p.range).toBeNull();
		expect(p.fromInput).toBe('2026-11-20');
	});

	it('custom range longer than 366 days is capped with a note', () => {
		const p = period('period=custom&from=2026-01-01&to=2028-12-31')!;
		expect(p.note).toBe(RANGE_CAPPED_NOTE);
		expect(p.toInput).toBe('2027-01-01');
		expect(iso(p.range?.to)).toBe('2027-01-02T05:00:00.000Z');
		expect(period('period=custom&from=2026-01-01&to=2027-01-01')!.note).toBeNull();
	});

	it('custom range with a bad date falls back to the current week', () => {
		for (const q of [
			'period=custom',
			'period=custom&from=2026-11-02&to=x',
			'period=custom&from='
		]) {
			const p = period(q)!;
			expect(p.label).toBe('Oct 26 – Nov 1, 2026');
			expect(p.error).toBeNull();
		}
	});
});

describe('periodQuery', () => {
	it('keeps only period params, and only with a period', () => {
		const params = new URLSearchParams('period=week&date=2026-11-02&unpaid=1&range=past');
		expect(periodQuery(params)).toEqual({ period: 'week', date: '2026-11-02' });
		expect(periodQuery(new URLSearchParams('date=2026-11-02'))).toEqual({});
	});
});
