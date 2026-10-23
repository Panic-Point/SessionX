import { escapeHtml, formatDateTime, formatMoney, formatTime } from '../format';
import type { EmailMessage } from './mailer';

export interface BookingEmailData {
	accountName: string;
	email: string;
	studentName: string;
	lessonTypeName: string;
	durationMin: number;
	startsAt: Date;
	timezone: string;
	priceCents: number;
	note: string;
	manageUrl: string;
}

function wrap(heading: string, rows: [string, string][], footerHtml: string): string {
	const body = rows
		.map(
			([k, v]) =>
				`<tr><td style="padding:4px 12px 4px 0;color:#555">${escapeHtml(k)}</td><td style="padding:4px 0">${escapeHtml(v)}</td></tr>`
		)
		.join('');
	return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#222;max-width:560px"><h2 style="font-size:18px;margin:0 0 12px">${escapeHtml(heading)}</h2><table style="border-collapse:collapse">${body}</table>${footerHtml}</div>`;
}

function details(d: BookingEmailData): [string, string][] {
	return [
		['Lesson', d.lessonTypeName],
		['Student', d.studentName],
		[
			'When',
			`${formatDateTime(d.startsAt, d.timezone)} (${formatTime(d.startsAt, d.timezone)}, ${d.durationMin} min)`
		],
		['Price', formatMoney(d.priceCents)]
	];
}

function textRows(rows: [string, string][]): string {
	return rows.map(([k, v]) => `${k}: ${v}`).join('\n');
}

export function requestReceivedEmail(d: BookingEmailData): EmailMessage {
	const when = formatDateTime(d.startsAt, d.timezone);
	const rows = details(d);
	if (d.note) rows.push(['Note', d.note]);
	const text = `Hi ${d.accountName},\n\nWe received your lesson request. You will hear back once it is confirmed.\n\n${textRows(rows)}\n\nManage your request: ${d.manageUrl}\n`;
	const footer = `<p style="margin:16px 0 0">Manage your request: <a href="${escapeHtml(d.manageUrl)}">${escapeHtml(d.manageUrl)}</a></p>`;
	return {
		to: d.email,
		subject: `Lesson request received – ${d.lessonTypeName} on ${when}`,
		text,
		html: wrap(`Hi ${d.accountName}, we received your lesson request`, rows, footer)
	};
}

export function newRequestEmail(d: BookingEmailData, adminEmail: string): EmailMessage {
	const when = formatDateTime(d.startsAt, d.timezone);
	const rows = details(d);
	rows.push(['Booked by', d.accountName], ['Email', d.email], ['Note', d.note || '(none)']);
	const text = `New lesson request.\n\n${textRows(rows)}\n\nManage: ${d.manageUrl}\n`;
	const footer = `<p style="margin:16px 0 0">Manage: <a href="${escapeHtml(d.manageUrl)}">${escapeHtml(d.manageUrl)}</a></p>`;
	return {
		to: adminEmail,
		subject: `New lesson request: ${d.studentName}, ${when}`,
		text,
		html: wrap('New lesson request', rows, footer)
	};
}
