import { describe, expect, it } from 'vitest';
import { escapeHtml, formatDateTime, formatMoney, formatTime } from './format';

describe('format', () => {
	it('formats money', () => {
		expect(formatMoney(3500)).toBe('$35.00');
		expect(formatMoney(5)).toBe('$0.05');
	});
	it('formats date time in EST', () => {
		expect(formatDateTime(new Date('2026-11-02T20:00:00Z'), 'America/New_York')).toBe(
			'Monday, November 2, 2026 at 3:00 PM EST'
		);
	});
	it('shows EDT during daylight time', () => {
		expect(formatDateTime(new Date('2026-03-08T19:00:00Z'), 'America/New_York')).toContain('EDT');
	});
	it('formats time', () => {
		expect(formatTime(new Date('2026-11-02T20:00:00Z'), 'America/New_York')).toBe('3:00 PM');
	});
	it('escapes html', () => {
		expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
			'&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;'
		);
	});
});
