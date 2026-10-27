import { describe, expect, it } from 'vitest';
import { buildIcs, buildIcsCalendar, type IcsEvent } from './ics';

const base: IcsEvent = {
	uid: 'b1@sessionx',
	start: new Date('2026-11-02T20:00:00Z'),
	end: new Date('2026-11-02T20:45:00Z'),
	summary: 'Piano lesson',
	description: 'Hello',
	url: 'https://x.test/m/1',
	now: new Date('2026-10-23T12:30:45Z')
};

describe('buildIcs', () => {
	it('contains UTC DTSTART/DTEND and UID', () => {
		const s = buildIcs(base);
		expect(s).toContain('BEGIN:VCALENDAR');
		expect(s).toContain('PRODID:-//SessionX//Booking//EN');
		expect(s).toContain('METHOD:PUBLISH');
		expect(s).toContain('UID:b1@sessionx');
		expect(s).toContain('DTSTART:20261102T200000Z');
		expect(s).toContain('DTEND:20261102T204500Z');
		expect(s).toContain('DTSTAMP:20261023T123045Z');
		expect(s).toContain('END:VEVENT');
	});
	it('uses CRLF', () => {
		const s = buildIcs(base);
		expect(s.endsWith('\r\n')).toBe(true);
		expect(s.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
	});
	it('escapes commas semicolons newlines', () => {
		const s = buildIcs({ ...base, summary: 'a,b;c\\d', description: 'l1\nl2' });
		expect(s).toContain('SUMMARY:a\\,b\\;c\\\\d');
		expect(s).toContain('DESCRIPTION:l1\\nl2');
	});
	it('folds long lines at 75 octets', () => {
		const s = buildIcs({ ...base, description: 'é'.repeat(100) + 'x'.repeat(100) });
		const enc = new TextEncoder();
		const lines = s.split('\r\n');
		for (const l of lines) expect(enc.encode(l).length).toBeLessThanOrEqual(75);
		const unfolded = s.replace(/\r\n /g, '');
		expect(unfolded).toContain('DESCRIPTION:' + 'é'.repeat(100) + 'x'.repeat(100));
		expect(lines.some((l) => l.startsWith(' '))).toBe(true);
	});
});

describe('buildIcsCalendar', () => {
	it('puts every event in one calendar', () => {
		const s = buildIcsCalendar([
			base,
			{ ...base, uid: 'b2@sessionx', start: new Date('2026-11-09T20:00:00Z') }
		]);
		expect(s.match(/BEGIN:VCALENDAR/g)).toHaveLength(1);
		expect(s.match(/BEGIN:VEVENT/g)).toHaveLength(2);
		expect(s).toContain('UID:b2@sessionx');
		expect(s).toContain('DTSTART:20261109T200000Z');
		expect(s.endsWith('END:VCALENDAR\r\n')).toBe(true);
	});
});
