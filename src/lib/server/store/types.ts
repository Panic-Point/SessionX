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

export type AccountRole = 'client' | 'admin';

export interface Account {
	id: string;
	name: string;
	email: string;
	role: AccountRole;
}

export interface AdminLessonType extends LessonType {
	active: boolean;
}

export interface LessonTypeInput {
	name: string;
	description: string;
	durationMin: number;
	priceCents: number;
	sortOrder: number;
	active: boolean;
}

export interface DateOverrideWithNote extends DateOverride {
	note: string;
}

export interface AdminBooking {
	id: string;
	status: BookingStatus;
	startsAt: Date;
	endsAt: Date;
	lessonTypeName: string;
	durationMin: number;
	studentName: string;
	accountName: string;
	accountEmail: string;
	priceCents: number;
	paidAt: Date | null;
	note: string;
	declineReason: string | null;
	lateCancel: boolean;
	manageToken: string;
}

/** `from` is inclusive and `to` exclusive, both on startsAt. */
export interface BookingFilter {
	statuses: BookingStatus[];
	from?: Date;
	to?: Date;
	unpaidOnly?: boolean;
	order: 'asc' | 'desc';
}

export type AdminStoreErrorCode = 'not_found' | 'not_pending' | 'in_past';

export class AdminStoreError extends Error {
	constructor(public readonly code: AdminStoreErrorCode) {
		super(code);
		this.name = 'AdminStoreError';
	}
}

export interface AdminStore {
	/** Trim + case-insensitive. */
	findAccountByEmail(email: string): Promise<Account | null>;
	findAccountById(id: string): Promise<Account | null>;
	createLoginToken(accountId: string, tokenHash: string, expiresAt: Date): Promise<void>;
	/** Returns the accountId and marks the token used; null if unknown, used or expired (expiresAt <= now). */
	consumeLoginToken(tokenHash: string, now: Date): Promise<string | null>;
	listBookings(filter: BookingFilter): Promise<AdminBooking[]>;
	getBooking(id: string): Promise<AdminBooking | null>;
	/** Throws AdminStoreError: not_found; not_pending; in_past when approving a booking with startsAt <= now. */
	decideBooking(
		id: string,
		decision: 'approved' | 'declined',
		reason: string | null,
		now: Date
	): Promise<AdminBooking>;
	/** Throws AdminStoreError not_found. */
	setPaid(id: string, paidAt: Date | null): Promise<AdminBooking>;
	updateSettings(settings: StudioSettings): Promise<void>;
	replaceWeeklyHours(hours: WeeklyHours[]): Promise<void>;
	/** date >= fromDate, ascending. */
	listDateOverrides(fromDate: string): Promise<DateOverrideWithNote[]>;
	saveDateOverride(override: DateOverrideWithNote): Promise<void>;
	deleteDateOverride(date: string): Promise<void>;
	/** Including inactive, by sortOrder then name. */
	listAllLessonTypes(): Promise<AdminLessonType[]>;
	createLessonType(input: LessonTypeInput): Promise<AdminLessonType>;
	/** Throws AdminStoreError not_found. */
	updateLessonType(id: string, input: LessonTypeInput): Promise<AdminLessonType>;
}
