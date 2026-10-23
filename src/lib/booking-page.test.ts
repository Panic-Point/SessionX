import { describe, expect, it } from 'vitest';
import { pickSelectedDate } from './booking-page';

const days = {
	'2026-10-24': [],
	'2026-10-26': [{ t: 1 }],
	'2026-10-27': [{ t: 1 }, { t: 2 }]
};

describe('pickSelectedDate', () => {
	it('returns a valid open requested day', () => {
		expect(pickSelectedDate(days, '2026-10-27')).toBe('2026-10-27');
	});
	it('falls back to the first open day when requested is missing', () => {
		expect(pickSelectedDate(days, null)).toBe('2026-10-26');
	});
	it('falls back when the requested day is closed', () => {
		expect(pickSelectedDate(days, '2026-10-24')).toBe('2026-10-26');
	});
	it('falls back when the requested day is not in the month', () => {
		expect(pickSelectedDate(days, '2026-11-02')).toBe('2026-10-26');
	});
	it('falls back on a malformed date', () => {
		expect(pickSelectedDate(days, '26-10-27')).toBe('2026-10-26');
	});
	it.each(['toString', 'constructor', '__proto__', 'valueOf', 'hasOwnProperty'])(
		'ignores prototype key %s',
		(key) => {
			expect(pickSelectedDate(days, key)).toBe('2026-10-26');
		}
	);
	it('returns null when no day is open', () => {
		expect(pickSelectedDate({ '2026-10-24': [] }, 'toString')).toBeNull();
	});
});
