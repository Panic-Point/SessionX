import { escapeHtml, formatDateTime, formatMoney, formatTime } from '../format';
import { buildIcs, buildIcsCalendar } from './ics';
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

export function newRequestEmail(
	d: BookingEmailData,
	adminEmail: string,
	/** Required: the family's manage link must never reach the admin as a fallback. */
	adminUrl: string
): EmailMessage {
	const when = formatDateTime(d.startsAt, d.timezone);
	const rows = details(d);
	rows.push(['Booked by', d.accountName], ['Email', d.email], ['Note', d.note || '(none)']);
	const text = `New lesson request.\n\n${textRows(rows)}\n\nManage: ${adminUrl}\n`;
	const footer = `<p style="margin:16px 0 0">Manage: <a href="${escapeHtml(adminUrl)}">${escapeHtml(adminUrl)}</a></p>`;
	return {
		to: adminEmail,
		subject: `New lesson request: ${d.studentName}, ${when}`,
		text,
		html: wrap('New lesson request', rows, footer)
	};
}

export function registerInviteEmail(to: string, name: string, url: string): EmailMessage {
	const text = `Hi ${name},\n\nThanks for your lesson request. Create a SessionX account with this email to see your lessons, book again faster and manage your requests in one place. Any lessons you have already booked with this email will be there.\n\nCreate your account: ${url}\n\nYou don't need an account: your request stands either way.\n`;
	const footer = `<p style="margin:0 0 12px">Thanks for your lesson request. Create a SessionX account with this email to see your lessons, book again faster and manage your requests in one place. Any lessons you have already booked with this email will be there.</p><p style="margin:16px 0 0">Create your account: <a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p><p style="color:#555">You don't need an account: your request stands either way.</p>`;
	return {
		to,
		subject: 'Create your SessionX account',
		text,
		html: wrap(`Hi ${name}, create your account`, [], footer)
	};
}

export function verifyRegistrationEmail(to: string, name: string, url: string): EmailMessage {
	const text = `Hi ${name},\n\nUse this link to confirm your email and finish creating your SessionX account. Your password starts working once you do. The link expires in 24 hours and can be used once.\n\n${url}\n\nIf you did not try to create an account, you can ignore this email and nothing will change.\n`;
	const footer = `<p style="margin:0 0 12px">Confirm your email to finish creating your account. Your password starts working once you do.</p><p style="margin:16px 0 0"><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p><p style="color:#555">It expires in 24 hours and can be used once. If you did not try to create an account, you can ignore this email and nothing will change.</p>`;
	return {
		to,
		subject: 'Finish creating your SessionX account',
		text,
		html: wrap(`Hi ${name}, confirm your email`, [], footer)
	};
}

export function passwordResetEmail(to: string, name: string, url: string): EmailMessage {
	const text = `Hi ${name},\n\nUse this link to choose a new SessionX password. It expires in 30 minutes and can be used once.\n\n${url}\n\nIf you did not ask to reset your password, you can ignore this email and your password will not change.\n`;
	const footer = `<p style="margin:16px 0 0"><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p><p style="color:#555">It expires in 30 minutes and can be used once. If you did not ask to reset your password, you can ignore this email and your password will not change.</p>`;
	return {
		to,
		subject: 'Reset your SessionX password',
		text,
		html: wrap(`Hi ${name}, reset your password`, [], footer)
	};
}

export function bookingApprovedEmail(
	d: BookingEmailData,
	bookingId: string,
	now: Date
): EmailMessage {
	const when = formatDateTime(d.startsAt, d.timezone);
	const rows = details(d);
	const text = `Hi ${d.accountName},\n\nYour lesson is confirmed. A calendar invite is attached.\n\n${textRows(rows)}\n\nManage your booking: ${d.manageUrl}\n`;
	const footer = `<p style="margin:16px 0 0">A calendar invite is attached.</p><p style="margin:8px 0 0">Manage your booking: <a href="${escapeHtml(d.manageUrl)}">${escapeHtml(d.manageUrl)}</a></p>`;
	const ics = buildIcs({
		uid: `${bookingId}@sessionx`,
		start: d.startsAt,
		end: new Date(d.startsAt.getTime() + d.durationMin * 60_000),
		summary: `${d.lessonTypeName} – ${d.studentName}`,
		description: `${d.lessonTypeName} for ${d.studentName}. Manage: ${d.manageUrl}`,
		url: d.manageUrl,
		now
	});
	return {
		to: d.email,
		subject: `Lesson confirmed – ${d.lessonTypeName} on ${when}`,
		text,
		html: wrap(`Hi ${d.accountName}, your lesson is confirmed`, rows, footer),
		attachments: [{ filename: 'lesson.ics', contentType: 'text/calendar', content: ics }]
	};
}

export function bookingDeclinedEmail(d: BookingEmailData, reason: string | null): EmailMessage {
	const when = formatDateTime(d.startsAt, d.timezone);
	const rows = details(d);
	if (reason) rows.push(['Reason', reason]);
	const text = `Hi ${d.accountName},\n\nUnfortunately we could not accept your lesson request.\n\n${textRows(rows)}\n`;
	return {
		to: d.email,
		subject: `Lesson request declined – ${d.lessonTypeName} on ${when}`,
		text,
		html: wrap(`Hi ${d.accountName}, we could not accept your lesson request`, rows, '')
	};
}

export function cancellationConfirmationEmail(d: BookingEmailData): EmailMessage {
	const when = formatDateTime(d.startsAt, d.timezone);
	const rows = details(d);
	const text = `Hi ${d.accountName},

Your lesson has been cancelled.

${textRows(rows)}
`;
	return {
		to: d.email,
		subject: `Lesson cancelled – ${d.lessonTypeName} on ${when}`,
		text,
		html: wrap(`Hi ${d.accountName}, your lesson has been cancelled`, rows, '')
	};
}

export function cancellationNoticeEmail(
	d: BookingEmailData,
	adminEmail: string,
	adminUrl: string,
	late: boolean,
	cutoffHours: number
): EmailMessage {
	const when = formatDateTime(d.startsAt, d.timezone);
	const rows = details(d);
	rows.push(['Booked by', d.accountName], ['Email', d.email]);
	const lateSentence = `This cancellation is less than ${cutoffHours} hours before the lesson.`;
	const intro = late ? `A lesson was cancelled. ${lateSentence}` : 'A lesson was cancelled.';
	const text = `${intro}

${textRows(rows)}

Lessons: ${adminUrl}
`;
	const latePara = late
		? `<p style="margin:0 0 12px;color:#b00020">${escapeHtml(lateSentence)}</p>`
		: '';
	const footer = `<p style="margin:16px 0 0">Lessons: <a href="${escapeHtml(adminUrl)}">${escapeHtml(adminUrl)}</a></p>`;
	return {
		to: adminEmail,
		subject: late
			? `Late cancellation: ${d.studentName}, ${when}`
			: `Lesson cancelled: ${d.studentName}, ${when}`,
		text,
		html: latePara + wrap('Lesson cancelled', rows, footer)
	};
}

export interface SeriesEmailData {
	accountName: string;
	email: string;
	studentName: string;
	lessonTypeName: string;
	durationMin: number;
	timezone: string;
	priceCents: number;
	/** e.g. "Weekly · Tue 3:00pm" */
	scheduleLabel: string;
}

export interface SeriesLesson {
	bookingId: string;
	startsAt: Date;
	manageUrl: string;
}

export interface SkippedLesson {
	startsAt: Date;
	reason: string;
}

function seriesRows(d: SeriesEmailData): [string, string][] {
	return [
		['Lesson', `${d.lessonTypeName} (${d.durationMin} min)`],
		['Student', d.studentName],
		['Schedule', d.scheduleLabel],
		['Price per lesson', formatMoney(d.priceCents)]
	];
}

function htmlList(items: string[]): string {
	return `<ul style="margin:4px 0 0;padding-left:20px">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
}

/**
 * One email for a whole new series: the dates booked (each with its own manage link), any dates
 * skipped and why, and one .ics holding every booked lesson.
 */
export function seriesCreatedEmail(
	d: SeriesEmailData,
	booked: SeriesLesson[],
	skipped: SkippedLesson[],
	opts: { policyText: string; continues: boolean; now: Date }
): EmailMessage {
	const when = (at: Date) => formatDateTime(at, d.timezone);
	const rows = seriesRows(d);
	const more = opts.continues
		? 'More lessons are added automatically as the dates get closer. We will skip any date the studio is already booked or closed.'
		: '';

	const textParts = [
		`Hi ${d.accountName},`,
		`${d.studentName} is booked for recurring lessons. A calendar file with every lesson is attached.`,
		textRows(rows),
		`Lessons booked:\n${booked.map((b) => `- ${when(b.startsAt)} (manage: ${b.manageUrl})`).join('\n')}`
	];
	if (skipped.length > 0) {
		textParts.push(
			`Dates skipped:\n${skipped.map((s) => `- ${when(s.startsAt)}: ${s.reason}`).join('\n')}`
		);
	}
	if (more) textParts.push(more);
	if (opts.policyText) textParts.push(`Cancellation policy: ${opts.policyText}`);

	let footer = `<p style="margin:16px 0 0">Lessons booked:</p>${htmlList(
		booked.map(
			(b) => `${escapeHtml(when(b.startsAt))} · <a href="${escapeHtml(b.manageUrl)}">Manage</a>`
		)
	)}`;
	if (skipped.length > 0) {
		footer += `<p style="margin:16px 0 0">Dates skipped:</p>${htmlList(
			skipped.map((s) => `${escapeHtml(when(s.startsAt))}: ${escapeHtml(s.reason)}`)
		)}`;
	}
	footer += '<p style="margin:16px 0 0">A calendar file with every lesson is attached.</p>';
	if (more) footer += `<p style="margin:8px 0 0">${escapeHtml(more)}</p>`;
	if (opts.policyText) {
		footer += `<p style="margin:8px 0 0;color:#555">Cancellation policy: ${escapeHtml(opts.policyText)}</p>`;
	}

	const ics = buildIcsCalendar(
		booked.map((b) => ({
			uid: `${b.bookingId}@sessionx`,
			start: b.startsAt,
			end: new Date(b.startsAt.getTime() + d.durationMin * 60_000),
			summary: `${d.lessonTypeName} – ${d.studentName}`,
			description: `${d.lessonTypeName} for ${d.studentName}. Manage: ${b.manageUrl}`,
			url: b.manageUrl,
			now: opts.now
		}))
	);
	return {
		to: d.email,
		subject: `Recurring lessons booked – ${d.studentName}, ${d.scheduleLabel}`,
		text: textParts.join('\n\n') + '\n',
		html: wrap(`Hi ${d.accountName}, recurring lessons are booked`, rows, footer),
		attachments: [{ filename: 'lessons.ics', contentType: 'text/calendar', content: ics }]
	};
}

/** One email when the admin ends a series, listing the lessons that were cancelled. */
export function seriesEndedEmail(d: SeriesEmailData, cancelled: Date[]): EmailMessage {
	const when = (at: Date) => formatDateTime(at, d.timezone);
	const rows = seriesRows(d);
	const text = `Hi ${d.accountName},\n\n${d.studentName}'s recurring lessons have been cancelled.\n\n${textRows(rows)}\n\nLessons cancelled:\n${cancelled.map((c) => `- ${when(c)}`).join('\n')}\n`;
	const footer = `<p style="margin:16px 0 0">Lessons cancelled:</p>${htmlList(cancelled.map((c) => escapeHtml(when(c))))}`;
	return {
		to: d.email,
		subject: `Recurring lessons cancelled – ${d.studentName}, ${d.scheduleLabel}`,
		text,
		html: wrap(`Hi ${d.accountName}, recurring lessons have been cancelled`, rows, footer)
	};
}
