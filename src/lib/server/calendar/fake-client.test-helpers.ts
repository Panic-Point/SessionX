import type { Interval } from '../availability';
import type { CalendarClient, CalendarEventInput } from './types';

export interface FakeCalendar extends CalendarClient {
	created: { calendarId: string; event: CalendarEventInput }[];
	deleted: { calendarId: string; eventId: string }[];
	busyCalls: { calendarIds: string[]; from: Date; to: Date }[];
	busyIntervals: Interval[];
	fail: { create?: boolean; delete?: boolean; busy?: boolean };
}

export function fakeCalendar(enabled = true): FakeCalendar {
	const fake: FakeCalendar = {
		enabled,
		serviceAccountEmail: enabled ? 'sa@example.iam.gserviceaccount.com' : null,
		created: [],
		deleted: [],
		busyCalls: [],
		busyIntervals: [],
		fail: {},
		async createEvent(calendarId, event) {
			if (fake.fail.create) throw new Error('google down');
			fake.created.push({ calendarId, event });
			return `evt-${fake.created.length}`;
		},
		async deleteEvent(calendarId, eventId) {
			if (fake.fail.delete) throw new Error('google down');
			fake.deleted.push({ calendarId, eventId });
		},
		async busy(calendarIds, from, to) {
			fake.busyCalls.push({ calendarIds, from, to });
			if (fake.fail.busy) throw new Error('google down');
			return fake.busyIntervals;
		}
	};
	return fake;
}
