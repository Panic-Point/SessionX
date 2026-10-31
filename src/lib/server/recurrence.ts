import { DateTime } from 'luxon';

export interface RecurrenceRule {
	/** ISO weekday: 1 = Monday ... 7 = Sunday */
	weekday: number;
	/** HH:mm, studio local time */
	startTime: string;
	intervalWeeks: 1 | 2;
	/** yyyy-MM-dd; the first lesson is the first `weekday` on or after it. */
	startsOn: string;
	/** yyyy-MM-dd, inclusive; null when the series ends by count or not at all. */
	endsOn: string | null;
	/** Number of lesson dates; null when the series ends by date or not at all. */
	occurrenceCount: number | null;
}

export interface Occurrence {
	/** yyyy-MM-dd in the studio timezone */
	date: string;
	startsAt: Date;
}

/** Occurrences are created this far ahead; the daily cron tops up longer series. */
export const HORIZON_DAYS = 84;

const iso = (d: DateTime) => d.toISODate()!;
const day = (date: string) => DateTime.fromISO(date, { zone: 'utc' });

/** The first lesson date: the rule's weekday on or after startsOn. */
export function firstDate(rule: RecurrenceRule): string {
	const start = day(rule.startsOn);
	return iso(start.plus({ days: (rule.weekday - start.weekday + 7) % 7 }));
}

/** The last lesson date the rule allows, or null for an open-ended series. */
export function lastDate(rule: RecurrenceRule): string | null {
	if (rule.occurrenceCount !== null) {
		const weeks = (rule.occurrenceCount - 1) * rule.intervalWeeks;
		return iso(day(firstDate(rule)).plus({ weeks }));
	}
	return rule.endsOn;
}

/** Lesson dates within [fromDate, toDate] (inclusive, yyyy-MM-dd) and the rule's own bounds. */
export function occurrenceDates(rule: RecurrenceRule, fromDate: string, toDate: string): string[] {
	const last = lastDate(rule);
	const until = last !== null && last < toDate ? last : toDate;
	const step = rule.intervalWeeks;
	const dates: string[] = [];
	for (let d = day(firstDate(rule)); iso(d) <= until; d = d.plus({ weeks: step })) {
		if (iso(d) >= fromDate) dates.push(iso(d));
	}
	return dates;
}

/**
 * Lesson start times for `occurrenceDates`, at the rule's wall-clock time in `timezone`, so 3:00pm
 * stays 3:00pm across a DST change. A time inside a DST gap moves forward, as Luxon does.
 */
export function occurrenceStarts(
	rule: RecurrenceRule,
	timezone: string,
	fromDate: string,
	toDate: string
): Occurrence[] {
	const [hour, minute] = rule.startTime.split(':').map(Number);
	return occurrenceDates(rule, fromDate, toDate).map((date) => ({
		date,
		startsAt: DateTime.fromISO(date, { zone: timezone }).set({ hour, minute }).toJSDate()
	}));
}

/** Today's date (yyyy-MM-dd) in the studio timezone. */
export function localToday(now: Date, timezone: string): string {
	return iso(DateTime.fromJSDate(now, { zone: timezone }));
}

/** The last date to materialise now: the earlier of the series end and today + the horizon. */
export function materialiseThrough(rule: RecurrenceRule, today: string): string {
	const horizon = iso(day(today).plus({ days: HORIZON_DAYS }));
	const last = lastDate(rule);
	return last !== null && last < horizon ? last : horizon;
}

/** The day after a yyyy-MM-dd date. */
export function nextDate(date: string): string {
	return iso(day(date).plus({ days: 1 }));
}

const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "Weekly · Tue 3:00pm" or "Every 2 weeks · Tue 3:00pm". */
export function seriesLabel(rule: Pick<RecurrenceRule, 'weekday' | 'startTime' | 'intervalWeeks'>) {
	const [hour, minute] = rule.startTime.split(':').map(Number);
	const time = `${hour % 12 || 12}:${String(minute).padStart(2, '0')}${hour < 12 ? 'am' : 'pm'}`;
	return `${cadenceLabel(rule.intervalWeeks)} · ${WEEKDAY_NAMES[rule.weekday - 1]} ${time}`;
}

export function cadenceLabel(intervalWeeks: number): string {
	return intervalWeeks === 2 ? 'Every 2 weeks' : 'Weekly';
}

const WEEKDAY_PLURALS = [
	'Mondays',
	'Tuesdays',
	'Wednesdays',
	'Thursdays',
	'Fridays',
	'Saturdays',
	'Sundays'
];

const longDate = (date: string) => day(date).setLocale('en-US').toFormat('LLLL d, yyyy');

/**
 * The schedule as a sentence, for emails that describe a series instead of listing its dates:
 * "Weekly on Tuesdays at 3:00 PM, starting November 3, 2026, until December 15, 2026".
 */
export function scheduleDescription(rule: RecurrenceRule): string {
	const [hour, minute] = rule.startTime.split(':').map(Number);
	const time = `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
	const first = firstDate(rule);
	const head = `${cadenceLabel(rule.intervalWeeks)} on ${WEEKDAY_PLURALS[rule.weekday - 1]} at ${time}, starting ${longDate(first)}`;
	const last = lastDate(rule);
	if (last === null) return `${head}, with no end date`;
	// An end date need not fall on a lesson day: name the last lesson instead.
	const lastLesson = occurrenceDates(rule, first, last).at(-1) ?? first;
	const count = rule.occurrenceCount;
	return `${head}, until ${longDate(lastLesson)}${count !== null ? ` (${count === 1 ? '1 lesson' : `${count} lessons`})` : ''}`;
}
