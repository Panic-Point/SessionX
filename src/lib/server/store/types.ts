import type { WeeklyHours, DateOverride } from '../availability';

export type BookingStatus = 'pending' | 'approved' | 'declined' | 'cancelled' | 'expired';

export interface StudioSettings {
	timezone: string;
	minNoticeHours: number;
	maxAdvanceDays: number;
	slotIncrementMin: number;
	bufferMin: number;
	allowSameDay: boolean;
	cancelCutoffHours: number;
	cancellationPolicyText: string;
	adminEmail: string | null;
}

export interface LessonType {
	id: string;
	name: string;
	description: string;
	durationMin: number;
	priceCents: number;
	sortOrder: number;
}

/** A pending or approved booking. */
export interface LiveBooking {
	startsAt: Date;
	endsAt: Date;
	blockedUntil: Date;
}

export interface GuestBookingInput {
	email: string;
	accountName: string;
	studentName: string;
	lessonTypeId: string;
	startsAt: Date;
	note: string;
}

export interface CreatedBooking {
	bookingId: string;
	manageToken: string;
	priceCents: number;
	startsAt: Date;
	endsAt: Date;
}

export type BookingStoreErrorCode = 'slot_taken' | 'too_many_pending' | 'lesson_type_not_found';

export class BookingStoreError extends Error {
	constructor(public readonly code: BookingStoreErrorCode) {
		super(code);
		this.name = 'BookingStoreError';
	}
}

export interface BookingSummary {
	status: BookingStatus;
	startsAt: Date;
	endsAt: Date;
	lessonTypeName: string;
	studentName: string;
	priceCents: number;
	note: string;
}

export interface BookingStore {
	getSettings(): Promise<StudioSettings>;
	getWeeklyHours(): Promise<WeeklyHours[]>;
	/** Inclusive yyyy-MM-dd bounds. */
	getDateOverrides(fromDate: string, toDate: string): Promise<DateOverride[]>;
	/** Sorted by sortOrder. */
	getActiveLessonTypes(): Promise<LessonType[]>;
	/** Live bookings overlapping [from, to). */
	getLiveBookings(from: Date, to: Date): Promise<LiveBooking[]>;
	/** Throws BookingStoreError. */
	requestGuestBooking(input: GuestBookingInput, now: Date): Promise<CreatedBooking>;
	getBookingByManageToken(token: string): Promise<BookingSummary | null>;
}
