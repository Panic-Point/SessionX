export interface IcsEvent {
	uid: string;
	start: Date;
	end: Date;
	summary: string;
	description: string;
	url: string;
	now: Date;
}

function utc(d: Date): string {
	return d
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}/, '');
}

function escapeText(s: string): string {
	return s
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,')
		.replace(/\r\n|\r|\n/g, '\\n');
}

const encoder = new TextEncoder();

/** Fold at 75 octets (UTF-8) without splitting a character; continuations start with one space. */
function fold(line: string): string[] {
	const out: string[] = [];
	let cur = '';
	let curBytes = 0;
	for (const ch of line) {
		const n = encoder.encode(ch).length;
		if (curBytes + n > 75) {
			out.push(cur);
			cur = ' ';
			curBytes = 1;
		}
		cur += ch;
		curBytes += n;
	}
	out.push(cur);
	return out;
}

export function buildIcs(e: IcsEvent): string {
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//SessionX//Booking//EN',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		'BEGIN:VEVENT',
		`UID:${e.uid}`,
		`DTSTAMP:${utc(e.now)}`,
		`DTSTART:${utc(e.start)}`,
		`DTEND:${utc(e.end)}`,
		`SUMMARY:${escapeText(e.summary)}`,
		`DESCRIPTION:${escapeText(e.description)}`,
		`URL:${e.url}`,
		'END:VEVENT',
		'END:VCALENDAR'
	];
	return lines.flatMap(fold).join('\r\n') + '\r\n';
}
