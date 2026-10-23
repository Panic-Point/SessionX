const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The day to show times for: the requested day if it is a well-formed, open day of this
 * month, otherwise the first open day (or null when none is open).
 */
export function pickSelectedDate(
	days: Record<string, unknown[]>,
	requested: string | null
): string | null {
	const isOpen = (date: string) => Object.hasOwn(days, date) && days[date].length > 0;
	if (requested && DATE_PATTERN.test(requested) && isOpen(requested)) return requested;
	return Object.keys(days).sort().find(isOpen) ?? null;
}
