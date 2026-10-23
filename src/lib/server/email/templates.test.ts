import { describe, expect, it } from 'vitest';
import {
	bookingApprovedEmail,
	bookingDeclinedEmail,
	loginLinkEmail,
	newRequestEmail,
	requestReceivedEmail,
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
		const m = newRequestEmail(data, 'teacher@example.com');
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
		for (const m of [requestReceivedEmail(d), newRequestEmail(d, 't@e.com')]) {
			expect(m.html).toContain('&lt;script&gt;');
			expect(m.html).not.toContain('<script>');
		}
	});

	it('text part has no HTML tags', () => {
		for (const m of [requestReceivedEmail(data), newRequestEmail(data, 't@e.com')]) {
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
		const m = loginLinkEmail('a@b.com', 'Ann', 'https://x.test/admin/verify?token=abc');
		expect(m.to).toBe('a@b.com');
		expect(m.subject).toBe('Your SessionX sign-in link');
		expect(m.text).toContain('https://x.test/admin/verify?token=abc');
		expect(m.html).toContain('https://x.test/admin/verify?token=abc');
	});
});
