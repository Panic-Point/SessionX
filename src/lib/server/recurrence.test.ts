import { describe, expect, it } from 'vitest';
import {
	firstDate,
	lastDate,
	localToday,
	materialiseThrough,
	nextDate,
	occurrenceDates,
	occurrenceStarts,
	scheduleDescription,
	seriesLabel,
	type RecurrenceRule
} from './recurrence';

const ZONE = 'America/New_York';

function rule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
	return {
		weekday: 2,
		startTime: '15:00',
		intervalWeeks: 1,
		startsOn: '2027-03-01',
		endsOn: null,
		occurrenceCount: null,
		...overrides
	};
}

describe('recurrence', () => {
	it('starts on the first matching weekday on or after the start date', () => {
		expect(firstDate(rule({ startsOn: '2027-03-01' }))).toBe('2027-03-02'); // Monday -> Tuesday
		expect(firstDate(rule({ startsOn: '2027-03-02' }))).toBe('2027-03-02');
		expect(firstDate(rule({ startsOn: '2027-03-03' }))).toBe('2027-03-09');
		expect(firstDate(rule({ weekday: 7, startsOn: '2027-03-01' }))).toBe('2027-03-07');
	});

	it('ends by count, by date, or not at all', () => {
		expect(lastDate(rule({ occurrenceCount: 10 }))).toBe('2027-05-04');
		expect(lastDate(rule({ occurrenceCount: 10, intervalWeeks: 2 }))).toBe('2027-07-06');
		expect(lastDate(rule({ occurrenceCount: 1 }))).toBe('2027-03-02');
		expect(lastDate(rule({ endsOn: '2027-04-01' }))).toBe('2027-04-01');
		expect(lastDate(rule())).toBeNull();
	});

	it('lists weekly dates inside the range and the rule bounds', () => {
		expect(occurrenceDates(rule({ occurrenceCount: 3 }), '2027-01-01', '2027-12-31')).toEqual([
			'2027-03-02',
			'2027-03-09',
			'2027-03-16'
		]);
		expect(occurrenceDates(rule({ endsOn: '2027-03-16' }), '2027-03-05', '2027-12-31')).toEqual([
			'2027-03-09',
			'2027-03-16'
		]);
		expect(occurrenceDates(rule(), '2027-03-01', '2027-03-20')).toEqual([
			'2027-03-02',
			'2027-03-09',
			'2027-03-16'
		]);
	});

	it('every 2 weeks stays on the cadence anchored at the first lesson', () => {
		const r = rule({ intervalWeeks: 2 });
		expect(occurrenceDates(r, '2027-03-01', '2027-04-30')).toEqual([
			'2027-03-02',
			'2027-03-16',
			'2027-03-30',
			'2027-04-13',
			'2027-04-27'
		]);
		// A later window picks up the same cadence, not a new one.
		expect(occurrenceDates(r, '2027-03-10', '2027-04-01')).toEqual(['2027-03-16', '2027-03-30']);
	});

	it('count includes every date of the rule, from the first lesson', () => {
		expect(occurrenceDates(rule({ occurrenceCount: 2 }), '2027-03-09', '2027-12-31')).toEqual([
			'2027-03-09'
		]);
	});

	it('keeps 3:00pm local across the spring and autumn DST changes', () => {
		const spring = occurrenceStarts(rule(), ZONE, '2027-03-01', '2027-03-20');
		expect(spring.map((o) => o.startsAt.toISOString())).toEqual([
			'2027-03-02T20:00:00.000Z',
			'2027-03-09T20:00:00.000Z',
			'2027-03-16T19:00:00.000Z' // clocks went forward on 2027-03-14
		]);
		const autumn = occurrenceStarts(
			rule({ startsOn: '2027-10-26' }),
			ZONE,
			'2027-10-26',
			'2027-11-09'
		);
		expect(autumn.map((o) => o.startsAt.toISOString())).toEqual([
			'2027-10-26T19:00:00.000Z',
			'2027-11-02T19:00:00.000Z',
			'2027-11-09T20:00:00.000Z' // clocks went back on 2027-11-07
		]);
		expect(spring[2].date).toBe('2027-03-16');
	});

	it('uses the studio timezone, not UTC', () => {
		const [o] = occurrenceStarts(
			rule({ startTime: '21:30' }),
			'Pacific/Auckland',
			'2027-03-01',
			'2027-03-02'
		);
		expect(o.startsAt.toISOString()).toBe('2027-03-02T08:30:00.000Z');
	});

	it('materialises up to 12 weeks ahead, or the series end if sooner', () => {
		expect(materialiseThrough(rule(), '2027-03-01')).toBe('2027-05-24');
		expect(materialiseThrough(rule({ occurrenceCount: 4 }), '2027-03-01')).toBe('2027-03-23');
		expect(materialiseThrough(rule({ endsOn: '2028-01-01' }), '2027-03-01')).toBe('2027-05-24');
	});

	it('helpers', () => {
		expect(nextDate('2027-02-28')).toBe('2027-03-01');
		// 11pm New York on the 1st is already the 2nd in UTC.
		expect(localToday(new Date('2027-03-02T04:00:00Z'), ZONE)).toBe('2027-03-01');
		expect(seriesLabel({ weekday: 2, startTime: '15:00', intervalWeeks: 1 })).toBe(
			'Weekly · Tue 3:00pm'
		);
		expect(seriesLabel({ weekday: 7, startTime: '09:05', intervalWeeks: 2 })).toBe(
			'Every 2 weeks · Sun 9:05am'
		);
		expect(seriesLabel({ weekday: 1, startTime: '12:30', intervalWeeks: 1 })).toBe(
			'Weekly · Mon 12:30pm'
		);
	});

	it('describes the schedule as a sentence', () => {
		expect(scheduleDescription(rule())).toBe(
			'Weekly on Tuesdays at 3:00 PM, starting March 2, 2027, with no end date'
		);
		expect(scheduleDescription(rule({ occurrenceCount: 10 }))).toBe(
			'Weekly on Tuesdays at 3:00 PM, starting March 2, 2027, until May 4, 2027 (10 lessons)'
		);
		expect(scheduleDescription(rule({ occurrenceCount: 1 }))).toContain('(1 lesson)');
		// An end date that isn't a lesson day names the last lesson before it.
		expect(
			scheduleDescription(
				rule({ weekday: 7, startTime: '09:05', intervalWeeks: 2, endsOn: '2027-04-01' })
			)
		).toBe('Every 2 weeks on Sundays at 9:05 AM, starting March 7, 2027, until March 21, 2027');
		expect(scheduleDescription(rule({ startTime: '12:30', endsOn: '2027-03-02' }))).toBe(
			'Weekly on Tuesdays at 12:30 PM, starting March 2, 2027, until March 2, 2027'
		);
	});
});
