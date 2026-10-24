import { DateTime } from 'luxon';

export function formatMoney(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}

export function formatDateTime(at: Date, timezone: string): string {
	return DateTime.fromJSDate(at, { zone: timezone })
		.setLocale('en-US')
		.toFormat("cccc, LLLL d, yyyy 'at' h:mm a ZZZZ");
}

export function formatTime(at: Date, timezone: string): string {
	return DateTime.fromJSDate(at, { zone: timezone }).setLocale('en-US').toFormat('h:mm a');
}

export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
