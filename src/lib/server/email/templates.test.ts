import { describe, expect, it } from 'vitest';
import {
	bookingApprovedEmail,
	bookingDeclinedEmail,
	cancellationConfirmationEmail,
	cancellationNoticeEmail,
	loginLinkEmail,
	newRequestEmail,
	passwordResetEmail,
	requestReceivedEmail,
	verifyRegistrationEmail,
	type BookingEmailData
} from './templates';

const data: BookingEmailData = {
	accountName: 'Pat Parent',
	email: 'pat@example.com',
	studentName: 'Sam',
	lessonTypeName: 'Piano',
	durationMin: 45,
	startsAt: new Date('2026-11-02T20:00:00Z'),
	timezone: 'America/New_York',
	priceCents: 3500,
	note: 'Beginner',
	manageUrl: 'https://x.test/manage/abc'
};

describe('templates', () => {
	it('received email goes to booker and includes manage link, time, price', () => {
		const m = requestReceivedEmail(data);
		expect(m.to).toBe('pat@example.com');
		expect(m.subject).toBe(
			'Lesson request received – Piano on Monday, November 2, 2026 at 3:00 PM EST'
		);
		for (const part of [m.text, m.html]) {
			expect(part).toContain('https://x.test/manage/abc');
			expect(part).toContain('3:00 PM');
			expect(part).toContain('$35.00');
		}
	});

	it('teacher email includes booker contact and note', () => {
		const m = newRequestEmail(data, 'teacher@example.com', 'https://x.test/admin');
		expect(m.to).toBe('teacher@example.com');
		expect(m.subject).toBe('New lesson request: Sam, Monday, November 2, 2026 at 3:00 PM EST');
		for (const part of [m.text, m.html]) {
			expect(part).toContain('pat@example.com');
			expect(part).toContain('Pat Parent');
			expect(part).toContain('Beginner');
		}
	});

	it('escapes user input in html', () => {
		const evil = '<script>x</script>';
		const d = { ...data, studentName: evil, accountName: evil, note: evil, lessonTypeName: evil };
		for (const m of [
			requestReceivedEmail(d),
			newRequestEmail(d, 't@e.com', 'https://x.test/admin')
		]) {
			expect(m.html).toContain('&lt;script&gt;');
			expect(m.html).not.toContain('<script>');
		}
	});

	it('text part has no HTML tags', () => {
		for (const m of [
			requestReceivedEmail(data),
			newRequestEmail(data, 't@e.com', 'https://x.test/admin')
		]) {
			expect(m.text).not.toMatch(/<[a-z/][^>]*>/i);
		}
	});
});

describe('new templates', () => {
	const now = new Date('2026-10-23T12:00:00Z');
	it('approved email has ics attachment and confirmed subject', () => {
		const m = bookingApprovedEmail(data, 'bk1', now);
		expect(m.to).toBe('pat@example.com');
		expect(m.subject).toBe('Lesson confirmed – Piano on Monday, November 2, 2026 at 3:00 PM EST');
		expect(m.attachments).toHaveLength(1);
		const a = m.attachments![0];
		expect(a.filename).toBe('lesson.ics');
		expect(a.contentType).toBe('text/calendar');
		expect(a.content).toContain('UID:bk1@sessionx');
		expect(a.content).toContain('DTSTART:20261102T200000Z');
		expect(a.content).toContain('DTEND:20261102T204500Z');
	});
	it('declined email includes escaped reason', () => {
		const m = bookingDeclinedEmail(data, '<b>Sorry</b>');
		expect(m.subject).toBe(
			'Lesson request declined – Piano on Monday, November 2, 2026 at 3:00 PM EST'
		);
		expect(m.text).toContain('<b>Sorry</b>');
		expect(m.html).toContain('&lt;b&gt;Sorry&lt;/b&gt;');
		expect(m.html).not.toContain('<b>Sorry</b>');
		expect(bookingDeclinedEmail(data, null).text).not.toContain('Reason');
	});
	it('login email contains link', () => {
		const m = loginLinkEmail('a@b.com', 'Ann', 'https://x.test/login/verify?token=abc');
		expect(m.to).toBe('a@b.com');
		expect(m.subject).toBe('Your SessionX sign-in link');
		expect(m.text).toContain('https://x.test/login/verify?token=abc');
		expect(m.html).toContain('https://x.test/login/verify?token=abc');
	});
});

describe('password templates', () => {
	it('registration verification email carries the link and escapes the name', () => {
		const url = 'https://x.test/register/verify?token=abc';
		const m = verifyRegistrationEmail('a@b.com', 'Ann <b>', url);
		expect(m.to).toBe('a@b.com');
		expect(m.subject).toBe('Finish creating your SessionX account');
		expect(m.text).toContain(url);
		expect(m.text).toContain('24 hours');
		expect(m.html).toContain(url);
		expect(m.html).toContain('Ann &lt;b&gt;');
		expect(m.html).not.toContain('<b>');
	});

	it('password reset email carries the link and the 30-minute expiry', () => {
		const url = 'https://x.test/login/reset/complete?token=abc';
		const m = passwordResetEmail('a@b.com', 'Ann', url);
		expect(m.to).toBe('a@b.com');
		expect(m.subject).toBe('Reset your SessionX password');
		expect(m.text).toContain(url);
		expect(m.text).toContain('30 minutes');
		expect(m.html).toContain(url);
	});
});

describe('cancellation templates', () => {
	const when = 'Monday, November 2, 2026 at 3:00 PM EST';

	it('confirmation goes to the booker', () => {
		const m = cancellationConfirmationEmail(data);
		expect(m.to).toBe('pat@example.com');
		expect(m.subject).toBe(`Lesson cancelled – Piano on ${when}`);
	});

	it('notice subject differs for late, and the late sentence appears only when late', () => {
		const late = cancellationNoticeEmail(
			data,
			't@example.com',
			'https://x.test/admin/lessons',
			true,
			24
		);
		const normal = cancellationNoticeEmail(
			data,
			't@example.com',
			'https://x.test/admin/lessons',
			false,
			24
		);
		expect(late.to).toBe('t@example.com');
		expect(late.subject).toBe(`Late cancellation: Sam, ${when}`);
		expect(normal.subject).toBe(`Lesson cancelled: Sam, ${when}`);
		expect(late.text).toContain('This cancellation is less than 24 hours before the lesson.');
		expect(late.html).toContain('This cancellation is less than 24 hours before the lesson.');
		expect(normal.text).not.toContain('less than 24 hours');
		expect(normal.html).not.toContain('less than 24 hours');
		expect(late.text).toContain('https://x.test/admin/lessons');
	});

	it('escapes names in html', () => {
		const m = cancellationNoticeEmail(
			{ ...data, studentName: '<b>Sam</b>' },
			't@example.com',
			'https://x.test/admin/lessons',
			false,
			24
		);
		expect(m.html).not.toContain('<b>Sam</b>');
		expect(m.html).toContain('&lt;b&gt;Sam&lt;/b&gt;');
	});

	it('new request email links to the admin page, never the family manage link', () => {
		const m = newRequestEmail(data, 't@example.com', 'https://x.test/admin');
		for (const part of [m.text, m.html]) {
			expect(part).toContain('https://x.test/admin');
			expect(part).not.toContain('https://x.test/manage/abc');
		}
		// @ts-expect-error adminUrl is required so a family's manage link can never be the fallback.
		expect(() => newRequestEmail(data, 't@example.com')).toBeTypeOf('function');
	});
});
