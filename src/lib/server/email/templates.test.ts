import { describe, expect, it } from 'vitest';
import { newRequestEmail, requestReceivedEmail, type BookingEmailData } from './templates';

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
