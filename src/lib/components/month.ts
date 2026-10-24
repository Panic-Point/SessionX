/** Pure calendar helpers for `yyyy-MM` month strings. Calendar dates only, no timezones. */

function parseMonth(month: string): { year: number; monthIndex: number } {
	const m = /^(\d{4})-(\d{2})$/.exec(month);
	if (!m) throw new Error(`Invalid month: ${month}`);
	return { year: Number(m[1]), monthIndex: Number(m[2]) - 1 };
}

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

/** Weeks of the month, Sunday→Saturday, with `null` padding before the 1st and after the last day. */
export function monthGrid(month: string): (string | null)[][] {
	const { year, monthIndex } = parseMonth(month);
	const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
	const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

	const cells: (string | null)[] = Array.from({ length: firstWeekday }, () => null);
	for (let day = 1; day <= daysInMonth; day++) {
		cells.push(`${year}-${pad(monthIndex + 1)}-${pad(day)}`);
	}
	while (cells.length % 7 !== 0) cells.push(null);

	const weeks: (string | null)[][] = [];
	for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
	return weeks;
}

/** The month `delta` months after (or before, if negative) `month`. */
export function shiftMonth(month: string, delta: number): string {
	const { year, monthIndex } = parseMonth(month);
	const d = new Date(Date.UTC(year, monthIndex + delta, 1));
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}
