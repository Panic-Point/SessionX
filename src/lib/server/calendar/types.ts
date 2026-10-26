import type { Interval } from '../availability';

export interface CalendarEventInput {
	summary: string;
	description: string;
	start: Date;
	end: Date;
	timeZone: string;
}

export interface CalendarClient {
	readonly enabled: boolean;
	readonly serviceAccountEmail: string | null;
	/** Creates the event and returns its id. */
	createEvent(calendarId: string, event: CalendarEventInput): Promise<string>;
	/** Resolves when the event is gone, including when Google answers 404 or 410. */
	deleteEvent(calendarId: string, eventId: string): Promise<void>;
	/** Busy intervals across the calendars; [] without calling Google when calendarIds is empty. */
	busy(calendarIds: string[], from: Date, to: Date): Promise<Interval[]>;
}
