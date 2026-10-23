import { describe, expect, test } from 'vitest';
import { DateTime } from 'luxon';
import {
	getAvailableSlots,
	type BookingRules,
	type DateOverride,
	type Interval,
	type WeeklyHours
} from './availability';

const TZ = 'America/New_York';
const MONDAY = '2026-11-02';

const baseRules: BookingRules = {
	timezone: TZ,
	minNoticeHours: 24,
	maxAdvanceDays: 60,
	slotIncrementMin: 30,
	bufferMin: 0,
	allowSameDay: false
};
const mondayHours: WeeklyHours[] = [{ weekday: 1, start: '15:00', end: '17:00' }];

/** A wall-clock time in the studio's timezone, as a Date. */
const local = (iso: string) => DateTime.fromISO(iso, { zone: TZ }).toJSDate();
/** A wall-clock time in the studio's timezone, as the UTC ISO string the engine returns. */
const utc = (iso: string) => local(iso).toISOString();

function slotsFor(
	date: string,
	opts: {
		durationMin?: number;
		rules?: Partial<BookingRules>;
		hours?: WeeklyHours[];
		overrides?: DateOverride[];
		busy?: Interval[];
		now?: Date;
	} = {}
) {
	const result = getAvailableSlots(
		{
			durationMin: opts.durationMin ?? 60,
			fromDate: date,
			toDate: date,
			now: opts.now ?? local('2026-11-01T12:00')
		},
		{ ...baseRules, ...opts.rules },
		opts.hours ?? mondayHours,
		opts.overrides ?? [],
		opts.busy ?? []
	);
	return result[date];
}

describe('getAvailableSlots', () => {
	test('generates slots inside weekly hours', () => {
		expect(slotsFor(MONDAY)).toEqual([
			'2026-11-02T20:00:00.000Z',
			'2026-11-02T20:30:00.000Z',
			'2026-11-02T21:00:00.000Z'
		]);
	});

	test('no partial slot at window end', () => {
		expect(slotsFor(MONDAY, { durationMin: 90 })).toEqual([
			utc(`${MONDAY}T15:00`),
			utc(`${MONDAY}T15:30`)
		]);
	});

	test('closed override empties the day', () => {
		expect(slotsFor(MONDAY, { overrides: [{ date: MONDAY, isClosed: true, ranges: [] }] })).toEqual(
			[]
		);
	});

	test('override ranges replace weekly hours', () => {
		const overrides = [
			{ date: MONDAY, isClosed: false, ranges: [{ start: '10:00', end: '11:00' }] }
		];
		expect(slotsFor(MONDAY, { overrides, now: local('2026-10-30T12:00') })).toEqual([
			utc(`${MONDAY}T10:00`)
		]);
	});

	test('busy interval removes overlapping slots', () => {
		const busy = [{ start: local(`${MONDAY}T15:30`), end: local(`${MONDAY}T16:00`) }];
		expect(slotsFor(MONDAY, { durationMin: 30, busy })).toEqual([
			utc(`${MONDAY}T15:00`),
			utc(`${MONDAY}T16:00`),
			utc(`${MONDAY}T16:30`)
		]);
	});

	test('buffer blocks adjacent slot', () => {
		const busy = [{ start: local(`${MONDAY}T15:00`), end: local(`${MONDAY}T15:30`) }];
		const slots = slotsFor(MONDAY, { durationMin: 30, busy, rules: { bufferMin: 15 } });
		expect(slots).not.toContain(utc(`${MONDAY}T15:30`));
		expect(slots).toContain(utc(`${MONDAY}T16:00`));
	});

	test("an existing booking's stored blockedUntil still blocks after the buffer is lowered", () => {
		const busy = [
			{
				start: local(`${MONDAY}T15:00`),
				end: local(`${MONDAY}T15:30`),
				blockedUntil: local(`${MONDAY}T15:45`)
			}
		];
		const slots = slotsFor(MONDAY, { durationMin: 30, busy, rules: { bufferMin: 0 } });
		expect(slots).not.toContain(utc(`${MONDAY}T15:30`));
		expect(slots).toContain(utc(`${MONDAY}T16:00`));
	});

	test('min notice boundary: exactly min notice away is allowed', () => {
		expect(slotsFor(MONDAY, { now: local('2026-11-01T15:00') })).toContain(utc(`${MONDAY}T15:00`));
	});

	test('min notice boundary: one minute short is excluded', () => {
		expect(slotsFor(MONDAY, { now: local('2026-11-01T15:01') })).not.toContain(
			utc(`${MONDAY}T15:00`)
		);
	});

	test('no same-day bookings when disallowed', () => {
		const now = local(`${MONDAY}T09:00`);
		expect(slotsFor(MONDAY, { now, rules: { minNoticeHours: 0 } })).toEqual([]);
	});

	test('same-day bookings allowed when enabled', () => {
		const now = local(`${MONDAY}T09:00`);
		expect(slotsFor(MONDAY, { now, rules: { minNoticeHours: 0, allowSameDay: true } })).not.toEqual(
			[]
		);
	});

	test('max advance: dates beyond the booking window have no slots', () => {
		const result = getAvailableSlots(
			{ durationMin: 60, fromDate: MONDAY, toDate: '2026-11-09', now: local('2026-11-01T12:00') },
			{ ...baseRules, maxAdvanceDays: 1 },
			mondayHours,
			[],
			[]
		);
		expect(result[MONDAY]).not.toEqual([]);
		expect(result['2026-11-09']).toEqual([]);
	});

	test('DST spring forward: no slots in the skipped hour, real duration respected', () => {
		const slots = slotsFor('2026-03-08', {
			hours: [{ weekday: 7, start: '01:00', end: '04:00' }],
			now: local('2026-03-01T12:00')
		});
		expect(slots).toEqual([
			'2026-03-08T06:00:00.000Z',
			'2026-03-08T06:30:00.000Z',
			'2026-03-08T07:00:00.000Z'
		]);
	});

	test('every date in range is a key', () => {
		const result = getAvailableSlots(
			{
				durationMin: 60,
				fromDate: '2026-11-01',
				toDate: '2026-11-03',
				now: local('2026-10-25T12:00')
			},
			baseRules,
			mondayHours,
			[],
			[]
		);
		expect(Object.keys(result)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
	});
});
