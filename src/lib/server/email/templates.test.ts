import { describe, expect, it } from 'vitest';
import {
	bookingApprovedEmail,
	bookingDeclinedEmail,
	cancellationConfirmationEmail,
	cancellationNoticeEmail,
	loginLinkEmail,
	newRequestEmail,
	requestReceivedEmail,
	seriesCreatedEmail,
	seriesEndedEmail,
	type BookingEmailData,
	type SeriesEmailData
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

const series: SeriesEmailData = {
	accountName: 'Pat Parent',
	email: 'pat@example.com',
	studentName: 'Ben',
	lessonTypeName: '30-minute lesson',
	durationMin: 30,
	timezone: 'America/New_York',
	priceCents: 3000,
	scheduleLabel: 'Weekly · Tue 3:00pm'
};

const booked = [
	{
		bookingId: 'b1',
		startsAt: new Date('2026-11-03T20:00:00Z'),
		manageUrl: 'https://x.test/manage/t1'
	},
	{
		bookingId: 'b2',
		startsAt: new Date('2026-11-17T20:00:00Z'),
		manageUrl: 'https://x.test/manage/t2'
	}
];

describe('series templates', () => {
	const now = new Date('2026-11-01T17:00:00Z');

	it('created email lists booked and skipped dates, price, policy and one .ics', () => {
		const m = seriesCreatedEmail(
			series,
			booked,
			[{ startsAt: new Date('2026-11-10T20:00:00Z'), reason: 'Studio closed that day' }],
			{ policyText: 'Cancel 24h ahead.', continues: false, now }
		);
		expect(m.to).toBe('pat@example.com');
		expect(m.subject).toBe('Recurring lessons booked – Ben, Weekly · Tue 3:00pm');
		for (const part of [m.text, m.html]) {
			expect(part).toContain('Tuesday, November 3, 2026 at 3:00 PM EST');
			expect(part).toContain('Tuesday, November 17, 2026 at 3:00 PM EST');
			expect(part).toContain('Tuesday, November 10, 2026 at 3:00 PM EST');
			expect(part).toContain('Studio closed that day');
			expect(part).toContain('$30.00');
			expect(part).toContain('Cancel 24h ahead.');
			expect(part).toContain('https://x.test/manage/t2');
			expect(part).not.toContain('added automatically');
		}
		expect(m.attachments).toHaveLength(1);
		const ics = m.attachments![0];
		expect(ics).toMatchObject({ filename: 'lessons.ics', contentType: 'text/calendar' });
		expect(ics.content.match(/BEGIN:VEVENT/g)).toHaveLength(2);
		expect(ics.content).toContain('UID:b1@sessionx');
		expect(ics.content).toContain('DTEND:20261117T203000Z');
	});

	it('created email leaves out empty sections and mentions top-ups for continuing series', () => {
		const m = seriesCreatedEmail(series, booked, [], { policyText: '', continues: true, now });
		expect(m.text).not.toContain('Dates skipped');
		expect(m.text).not.toContain('Cancellation policy');
		expect(m.text).toContain('More lessons are added automatically');
		expect(m.html).toContain('More lessons are added automatically');
	});

	it('created email escapes HTML', () => {
		const m = seriesCreatedEmail({ ...series, studentName: '<b>Ben</b>' }, booked, [], {
			policyText: '<i>x</i>',
			continues: false,
			now
		});
		expect(m.html).not.toContain('<b>Ben</b>');
		expect(m.html).not.toContain('<i>x</i>');
		expect(m.html).toContain('&lt;b&gt;Ben&lt;/b&gt;');
	});

	it('ended email lists the cancelled dates', () => {
		const m = seriesEndedEmail(series, [booked[1].startsAt]);
		expect(m.to).toBe('pat@example.com');
		expect(m.subject).toBe('Recurring lessons cancelled – Ben, Weekly · Tue 3:00pm');
		for (const part of [m.text, m.html]) {
			expect(part).toContain('Tuesday, November 17, 2026 at 3:00 PM EST');
			expect(part).not.toContain('November 3, 2026');
		}
		expect(m.attachments).toBeUndefined();
	});
});
