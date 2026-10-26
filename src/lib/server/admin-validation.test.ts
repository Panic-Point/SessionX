import { describe, expect, it } from 'vitest';
import {
	dollarsToCents,
	validateLessonType,
	validateOverride,
	validateSettings,
	validateWeeklyHours
} from './admin-validation';

function errorsOf(r: { ok: boolean; errors?: Record<string, string> }) {
	expect(r.ok).toBe(false);
	return r.errors!;
}

const goodSettings = {
	timezone: 'America/New_York',
	minNoticeHours: '24',
	maxAdvanceDays: '60',
	slotIncrementMin: '30',
	bufferMin: '15',
	allowSameDay: 'on',
	cancelCutoffHours: '48',
	cancellationPolicyText: 'Be kind.',
	adminEmail: 'teacher@example.com'
};

describe('validateSettings', () => {
	it('accepts a valid form', () => {
		expect(validateSettings(goodSettings)).toEqual({
			ok: true,
			value: {
				timezone: 'America/New_York',
				minNoticeHours: 24,
				maxAdvanceDays: 60,
				slotIncrementMin: 30,
				bufferMin: 15,
				allowSameDay: true,
				cancelCutoffHours: 48,
				cancellationPolicyText: 'Be kind.',
				adminEmail: 'teacher@example.com',
				gcalWriteCalendarId: null,
				gcalBusyCalendarIds: []
			}
		});
	});

	it('blank calendar fields are null and empty', () => {
		const r = validateSettings({
			...goodSettings,
			gcalWriteCalendarId: '   ',
			gcalBusyCalendarIds: ' \n , \n'
		});
		expect(r.ok && r.value.gcalWriteCalendarId).toBeNull();
		expect(r.ok && r.value.gcalBusyCalendarIds).toEqual([]);
	});

	it('trims the lesson calendar and parses, trims, and dedupes busy calendars', () => {
		const r = validateSettings({
			...goodSettings,
			gcalWriteCalendarId: '  teacher@gmail.com ',
			gcalBusyCalendarIds: 'a@x.com\n b@x.com , c@x.com\r\n\na@x.com,'
		});
		expect(r.ok && r.value.gcalWriteCalendarId).toBe('teacher@gmail.com');
		expect(r.ok && r.value.gcalBusyCalendarIds).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
	});

	it('allows 10 busy calendars and rejects 11', () => {
		const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${i}@x.com`).join('\n');
		expect(validateSettings({ ...goodSettings, gcalBusyCalendarIds: ids(10) }).ok).toBe(true);
		const e = errorsOf(validateSettings({ ...goodSettings, gcalBusyCalendarIds: ids(11) }));
		expect(e.gcalBusyCalendarIds).toBe('Use at most 10 calendars.');
	});

	it('rejects calendar IDs longer than 254 characters', () => {
		const long = 'x'.repeat(255);
		const ok = 'x'.repeat(254);
		expect(
			validateSettings({ ...goodSettings, gcalWriteCalendarId: ok, gcalBusyCalendarIds: ok }).ok
		).toBe(true);
		const e = errorsOf(
			validateSettings({
				...goodSettings,
				gcalWriteCalendarId: long,
				gcalBusyCalendarIds: `a@x.com\n${long}`
			})
		);
		expect(e.gcalWriteCalendarId).toBe('Enter a calendar ID (usually an email address).');
		expect(e.gcalBusyCalendarIds).toBe('Each calendar ID must be 254 characters or fewer.');
	});

	it('rejects the calendar ID "primary" in any case, for both fields', () => {
		const msg =
			'Use the calendar ID from Google Calendar → Settings → Integrate calendar (your Gmail address for your main calendar), not "primary".';
		const e = errorsOf(
			validateSettings({
				...goodSettings,
				gcalWriteCalendarId: 'Primary',
				gcalBusyCalendarIds: 'a@x.com\nPRIMARY'
			})
		);
		expect(e.gcalWriteCalendarId).toBe(msg);
		expect(e.gcalBusyCalendarIds).toBe(msg);
		const ok = validateSettings({
			...goodSettings,
			gcalWriteCalendarId: 'primary@x.com',
			gcalBusyCalendarIds: 'primary@x.com'
		});
		expect(ok.ok).toBe(true);
	});

	it('blank email is null and missing checkbox is false', () => {
		const r = validateSettings({ ...goodSettings, adminEmail: '  ', allowSameDay: undefined });
		expect(r.ok && r.value.adminEmail).toBeNull();
		expect(r.ok && r.value.allowSameDay).toBe(false);
	});

	it('rejects an invalid time zone', () => {
		const e = errorsOf(validateSettings({ ...goodSettings, timezone: 'Mars/Base' }));
		expect(e.timezone).toBe('Choose a valid time zone.');
	});

	it('rejects non-numeric and out-of-range numbers', () => {
		const e = errorsOf(
			validateSettings({
				...goodSettings,
				minNoticeHours: 'abc',
				cancelCutoffHours: '721',
				maxAdvanceDays: '0',
				slotIncrementMin: '25',
				bufferMin: '1.5'
			})
		);
		expect(e.minNoticeHours).toBe('Enter a whole number from 0 to 720.');
		expect(e.cancelCutoffHours).toBe('Enter a whole number from 0 to 720.');
		expect(e.maxAdvanceDays).toBe('Enter a whole number from 1 to 365.');
		expect(e.slotIncrementMin).toBe('Choose a slot interval.');
		expect(e.bufferMin).toBe('Enter a whole number from 0 to 120.');
	});

	it('rejects a long policy and a bad email', () => {
		const e = errorsOf(
			validateSettings({
				...goodSettings,
				cancellationPolicyText: 'x'.repeat(2001),
				adminEmail: 'nope'
			})
		);
		expect(e.cancellationPolicyText).toBe('Keep the policy under 2000 characters.');
		expect(e.adminEmail).toBe('Enter a valid email address.');
	});
});

describe('validateWeeklyHours', () => {
	it('accepts valid rows', () => {
		const r = validateWeeklyHours([
			{ weekday: '1', start: '09:00', end: '12:00' },
			{ weekday: '1', start: '12:00', end: '17:00' },
			{ weekday: '2', start: '09:00', end: '12:00' }
		]);
		expect(r).toEqual({
			ok: true,
			value: [
				{ weekday: 1, start: '09:00', end: '12:00' },
				{ weekday: 1, start: '12:00', end: '17:00' },
				{ weekday: 2, start: '09:00', end: '12:00' }
			]
		});
	});

	it('rejects bad time format and inverted ranges per row', () => {
		const e = errorsOf(
			validateWeeklyHours([
				{ weekday: '1', start: '9am', end: '12:00' },
				{ weekday: '2', start: '12:00', end: '09:00' },
				{ weekday: '3', start: '24:00', end: '25:00' }
			])
		);
		expect(e['row-0']).toBe('Use a time like 15:00.');
		expect(e['row-1']).toBe('End time must be after start time.');
		expect(e['row-2']).toBe('Use a time like 15:00.');
	});

	it('rejects overlapping ranges on the same weekday', () => {
		const e = errorsOf(
			validateWeeklyHours([
				{ weekday: '3', start: '09:00', end: '12:00' },
				{ weekday: '3', start: '11:00', end: '14:00' }
			])
		);
		expect(e['weekday-3']).toBe('Times overlap.');
	});

	it('rejects an invalid weekday', () => {
		const e = errorsOf(validateWeeklyHours([{ weekday: '8', start: '09:00', end: '10:00' }]));
		expect(e['row-0']).toBe('Choose a weekday.');
	});
});

describe('validateOverride', () => {
	const base = { date: '2026-12-24', isClosed: false, note: 'Holiday', ranges: [] };

	it('accepts open ranges', () => {
		const r = validateOverride({ ...base, ranges: [{ start: '10:00', end: '12:00' }] });
		expect(r).toEqual({
			ok: true,
			value: {
				date: '2026-12-24',
				isClosed: false,
				note: 'Holiday',
				ranges: [{ start: '10:00', end: '12:00' }]
			}
		});
	});

	it('closed day ignores ranges', () => {
		const r = validateOverride({
			...base,
			isClosed: true,
			ranges: [{ start: 'bad', end: 'worse' }]
		});
		expect(r).toEqual({
			ok: true,
			value: { date: '2026-12-24', isClosed: true, note: 'Holiday', ranges: [] }
		});
	});

	it('rejects a bad date', () => {
		expect(errorsOf(validateOverride({ ...base, date: '2026-13-01' })).date).toBe('Choose a date.');
		expect(errorsOf(validateOverride({ ...base, date: '' })).date).toBe('Choose a date.');
	});

	it('requires ranges when not closed', () => {
		expect(errorsOf(validateOverride(base)).ranges).toBe(
			'Add opening times or mark the day closed.'
		);
	});

	it('rejects bad, inverted and overlapping ranges', () => {
		expect(
			errorsOf(validateOverride({ ...base, ranges: [{ start: '9', end: '10:00' }] })).ranges
		).toBe('Use a time like 15:00.');
		expect(
			errorsOf(validateOverride({ ...base, ranges: [{ start: '10:00', end: '10:00' }] })).ranges
		).toBe('End time must be after start time.');
		expect(
			errorsOf(
				validateOverride({
					...base,
					ranges: [
						{ start: '10:00', end: '12:00' },
						{ start: '11:30', end: '13:00' }
					]
				})
			).ranges
		).toBe('Times overlap.');
	});

	it('rejects a long note', () => {
		const e = errorsOf(validateOverride({ ...base, isClosed: true, note: 'x'.repeat(201) }));
		expect(e.note).toBe('Keep the note under 200 characters.');
	});
});

describe('validateLessonType', () => {
	const good = {
		name: ' Piano 30 ',
		description: 'Basics',
		durationMin: '30',
		price: '35.50',
		sortOrder: '',
		active: 'on'
	};

	it('accepts a valid form', () => {
		expect(validateLessonType(good)).toEqual({
			ok: true,
			value: {
				name: 'Piano 30',
				description: 'Basics',
				durationMin: 30,
				priceCents: 3550,
				sortOrder: 0,
				active: true
			}
		});
	});

	it('rejects bad name, description, duration, price and sort order', () => {
		const e = errorsOf(
			validateLessonType({
				...good,
				name: ' ',
				description: 'x'.repeat(501),
				durationMin: '4',
				price: '$35',
				sortOrder: '1.5',
				active: undefined
			})
		);
		expect(e.name).toBe('Enter a name.');
		expect(e.description).toBe('Keep the description under 500 characters.');
		expect(e.durationMin).toBe('Enter minutes from 5 to 480.');
		expect(e.price).toBe('Enter a price like 35 or 35.00.');
		expect(e.sortOrder).toBe('Enter a whole number.');
	});

	it('rejects a long name and an over-limit price', () => {
		const e = errorsOf(validateLessonType({ ...good, name: 'x'.repeat(101), price: '1001' }));
		expect(e.name).toBe('Keep the name under 100 characters.');
		expect(e.price).toBe('Enter a price like 35 or 35.00.');
	});
});

describe('dollarsToCents', () => {
	it('parses valid amounts', () => {
		expect(dollarsToCents('35')).toBe(3500);
		expect(dollarsToCents('35.5')).toBe(3550);
		expect(dollarsToCents('35.50')).toBe(3550);
	});

	it('rejects invalid amounts', () => {
		for (const s of ['$35', '-1', 'abc', '35.555', '']) expect(dollarsToCents(s)).toBeNull();
	});
});
