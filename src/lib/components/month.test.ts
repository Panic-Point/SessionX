import { describe, expect, test } from 'vitest';
import { monthGrid, shiftMonth } from './month';

describe('monthGrid', () => {
	test('Nov 2026 starts on Sunday 2026-11-01 with no padding', () => {
		const grid = monthGrid('2026-11');
		expect(grid[0]).toEqual([
			'2026-11-01',
			'2026-11-02',
			'2026-11-03',
			'2026-11-04',
			'2026-11-05',
			'2026-11-06',
			'2026-11-07'
		]);
		expect(grid).toHaveLength(5);
		expect(grid[4]).toEqual(['2026-11-29', '2026-11-30', null, null, null, null, null]);
	});

	test('Feb 2026 fits exactly 4 rows', () => {
		const grid = monthGrid('2026-02');
		expect(grid).toHaveLength(4);
		expect(grid[0][0]).toBe('2026-02-01');
		expect(grid[3][6]).toBe('2026-02-28');
	});

	test('pads leading days with null (Oct 2026 starts on Thursday)', () => {
		const grid = monthGrid('2026-10');
		expect(grid[0]).toEqual([null, null, null, null, '2026-10-01', '2026-10-02', '2026-10-03']);
		expect(grid.every((week) => week.length === 7)).toBe(true);
		expect(grid.flat().filter((d) => d !== null)).toHaveLength(31);
	});

	test('handles leap-year February', () => {
		expect(
			monthGrid('2028-02')
				.flat()
				.filter((d) => d !== null)
		).toHaveLength(29);
	});
});

describe('shiftMonth', () => {
	test('rolls over the year forward', () => {
		expect(shiftMonth('2026-12', 1)).toBe('2027-01');
	});

	test('rolls over the year backward', () => {
		expect(shiftMonth('2026-01', -1)).toBe('2025-12');
	});

	test('shifts by several months', () => {
		expect(shiftMonth('2026-10', 3)).toBe('2027-01');
		expect(shiftMonth('2026-10', 0)).toBe('2026-10');
	});
});
