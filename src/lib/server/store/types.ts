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
	gcalWriteCalendarId: string | null;
	gcalBusyCalendarIds: string[];
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
	gcalEventId: string | null;
	/** Set when the booking is an occurrence of a recurring series. */
	series: SeriesTag | null;
}

/** The parts of a series a booking list needs to label and link an occurrence. */
export interface SeriesTag {
	id: string;
	weekday: number;
	/** HH:mm */
	startTime: string;
	intervalWeeks: 1 | 2;
}

export interface DateRange {
	from?: Date;
	to?: Date;
}

export interface AccountBookingFilter extends DateRange {
	/** Only this student's lessons; another account's student matches nothing. */
	studentId?: string;
}

/** `from` is inclusive and `to` exclusive, both on startsAt. */
export interface BookingFilter {
	statuses: BookingStatus[];
	from?: Date;
	to?: Date;
	unpaidOnly?: boolean;
	lateCancelOnly?: boolean;
	order: 'asc' | 'desc';
}

export type AdminStoreErrorCode = 'not_found' | 'not_pending' | 'in_past';

export class AdminStoreError extends Error {
	constructor(public readonly code: AdminStoreErrorCode) {
		super(code);
		this.name = 'AdminStoreError';
	}
}

/** What a password token is for. Registrations name an email that may not have an account yet. */
export type PasswordTokenData =
	{ purpose: 'register'; email: string } | { purpose: 'reset'; accountId: string };

/** Chosen on the page the registration link opens. `name` is used only for a new account. */
export interface RegistrationDetails {
	name: string;
	passwordHash: string;
}

export interface AdminStore {
	/** Trim + case-insensitive. */
	findAccountByEmail(email: string): Promise<Account | null>;
	findAccountById(id: string): Promise<Account | null>;
	createLoginToken(accountId: string, tokenHash: string, expiresAt: Date): Promise<void>;
	/** Returns the accountId and marks the token used; null if unknown, used or expired (expiresAt <= now). */
	consumeLoginToken(tokenHash: string, now: Date): Promise<string | null>;
	/** Null when the account has no password (or does not exist). */
	getPasswordHash(accountId: string): Promise<string | null>;
	/** Throws AdminStoreError not_found. */
	setPasswordHash(accountId: string, passwordHash: string): Promise<void>;
	createPasswordToken(tokenHash: string, data: PasswordTokenData, expiresAt: Date): Promise<void>;
	/**
	 * Creates a reset token for the account, created at `now`, unless the account has an unused
	 * reset token created after `since`. The check and the insert happen at once, so parallel
	 * requests create one token. Returns whether it was created; false for an unknown account.
	 */
	createResetTokenUnlessRecent(
		tokenHash: string,
		accountId: string,
		expiresAt: Date,
		since: Date,
		now: Date
	): Promise<boolean>;
	/**
	 * The token's data without using it; null if unknown, used, expired (expiresAt <= now) or of
	 * another purpose. Registration emails come back trimmed and lowercased.
	 */
	peekPasswordToken(
		tokenHash: string,
		purpose: PasswordTokenData['purpose'],
		now: Date
	): Promise<PasswordTokenData | null>;
	/**
	 * Uses a registration token: creates the account (role client) named `details.name` if its email
	 * has none, with the account holder as its first student (skipped when the trimmed name is
	 * empty); otherwise keeps the account's name, role and students. Sets the password, voids the
	 * account's other unused password tokens and clears the email's failures, all at once. Returns
	 * the accountId; null if unknown, used, expired (expiresAt <= now) or not a registration token.
	 */
	completeRegistration(
		tokenHash: string,
		details: RegistrationDetails,
		now: Date
	): Promise<string | null>;
	/** Like completeRegistration, for a reset token, setting `passwordHash`. */
	completePasswordReset(tokenHash: string, passwordHash: string, now: Date): Promise<string | null>;
	/** Failed password sign-ins for the email (trim + case-insensitive) with failedAt > since. */
	countPasswordFailures(email: string, since: Date): Promise<number>;
	/** Returns the failure's id, for removePasswordFailure. */
	recordPasswordFailure(email: string, failedAt: Date): Promise<string>;
	/** Removes one failure by id; no-op when it is already gone. */
	removePasswordFailure(id: string): Promise<void>;
	clearPasswordFailures(email: string): Promise<void>;
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
	/** Throws AdminStoreError not_found. Null clears the stored Google Calendar event id. */
	setCalendarEventId(bookingId: string, eventId: string | null): Promise<void>;
	/** Marks pending bookings with startsAt <= now as expired; returns how many. */
	expirePendingBookings(now: Date): Promise<number>;
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

export interface Student {
	id: string;
	accountId: string;
	name: string;
	notes: string;
}

export interface StudentPrice {
	studentId: string;
	lessonTypeId: string;
	priceCents: number;
}

export interface AccountBookingInput {
	accountId: string;
	studentId: string;
	lessonTypeId: string;
	startsAt: Date;
	note: string;
}

export interface AccountWithStudents extends Account {
	adminNotes: string;
	/** The family deleted their account; kept so their lesson history stays with the teacher. */
	deleted: boolean;
	students: (Student & { prices: StudentPrice[] })[];
}

export type CancelTarget =
	| { kind: 'account'; bookingId: string; accountId: string }
	| { kind: 'token'; manageToken: string };

export type AccountStoreErrorCode =
	'not_found' | 'duplicate_student' | 'duplicate_email' | 'not_cancellable';

export class AccountStoreError extends Error {
	constructor(public readonly code: AccountStoreErrorCode) {
		super(code);
		this.name = 'AccountStoreError';
	}
}

export interface AccountStore {
	/** By name. */
	listStudents(accountId: string): Promise<Student[]>;
	/** Trims. Throws AccountStoreError duplicate_student (case-insensitive). */
	addStudent(accountId: string, name: string): Promise<Student>;
	/** Throws AccountStoreError not_found (not this account's student) or duplicate_student. */
	renameStudent(accountId: string, studentId: string, name: string): Promise<Student>;
	listStudentPrices(studentIds: string[]): Promise<StudentPrice[]>;
	/**
	 * All statuses, all the account's students (or just `studentId`), startsAt descending. `from` is
	 * inclusive and `to` exclusive on startsAt.
	 */
	listAccountBookings(accountId: string, filter?: AccountBookingFilter): Promise<AdminBooking[]>;
	/**
	 * Price is the student's custom price, else the lesson type's. Throws AccountStoreError
	 * not_found (student not in account), then BookingStoreError lesson_type_not_found,
	 * too_many_pending, slot_taken, in that order.
	 */
	requestAccountBooking(input: AccountBookingInput, now: Date): Promise<CreatedBooking>;
	/**
	 * A lesson the admin books for a student: approved at once, with no pending-request limit.
	 * Price as requestAccountBooking. Throws AccountStoreError not_found (student not in account),
	 * then BookingStoreError lesson_type_not_found, slot_taken, in that order.
	 */
	createApprovedBooking(input: AccountBookingInput, now: Date): Promise<CreatedBooking>;
	/** Null when unknown, or when an account target names another account's booking. */
	getBookingByTarget(target: CancelTarget): Promise<AdminBooking | null>;
	/** Throws AccountStoreError not_found; not_cancellable (not pending/approved, or startsAt <= now). */
	cancelBooking(target: CancelTarget, lateCancel: boolean, now: Date): Promise<AdminBooking>;
	/**
	 * A client account the admin sets up, with no password and no students; the family can claim it
	 * later by registering or resetting the password with this email. Trims the name; the email is
	 * trimmed and lowercased. Throws AccountStoreError duplicate_email when an account that has not
	 * been deleted already uses it (case-insensitive).
	 */
	createAccount(name: string, email: string): Promise<Account>;
	/** By name. */
	listAccounts(): Promise<AccountWithStudents[]>;
	getAccount(accountId: string): Promise<AccountWithStudents | null>;
	/** Null removes the custom price. Throws AccountStoreError not_found. */
	setStudentPrice(
		studentId: string,
		lessonTypeId: string,
		priceCents: number | null
	): Promise<void>;
	/** Throws AccountStoreError not_found. */
	updateAccountNotes(accountId: string, notes: string): Promise<void>;
	/** Throws AccountStoreError not_found. */
	updateStudentNotes(studentId: string, notes: string): Promise<void>;
	/**
	 * Deletes a client account: it can no longer sign in (findAccountById/ByEmail return null), its
	 * email is freed for a fresh account, and its password and unused sign-in links are gone. The
	 * name, students and bookings stay for the teacher's records, and listAccounts/getAccount still
	 * return it with `deleted` set. Bookings are untouched: cancel them first. Throws
	 * AccountStoreError not_found (unknown, already deleted, or an admin).
	 */
	deleteAccount(accountId: string, now: Date): Promise<void>;
}

export interface SeriesInput {
	studentId: string;
	lessonTypeId: string;
	/** ISO weekday: 1 = Monday ... 7 = Sunday */
	weekday: number;
	/** HH:mm, studio local time */
	startTime: string;
	intervalWeeks: 1 | 2;
	/** yyyy-MM-dd */
	startsOn: string;
	endsOn: string | null;
	occurrenceCount: number | null;
	note: string;
}

export interface LessonSeries extends SeriesInput {
	id: string;
	studentName: string;
	accountId: string;
	accountName: string;
	accountEmail: string;
	lessonTypeName: string;
	durationMin: number;
	priceCents: number;
	/** Last date whose occurrence was created or skipped; null before the first. */
	materializedThrough: string | null;
	createdAt: Date;
	endedAt: Date | null;
}

/** One requested start: bookingId is null when it was skipped (clash, or not after now). */
export interface OccurrenceResult {
	startsAt: Date;
	bookingId: string | null;
}

export type SeriesStoreErrorCode = 'not_found' | 'ended';

export class SeriesStoreError extends Error {
	constructor(public readonly code: SeriesStoreErrorCode) {
		super(code);
		this.name = 'SeriesStoreError';
	}
}

export interface SeriesStore {
	/**
	 * Creates the series and its approved occurrences in one step, skipping (not failing) any
	 * start that overlaps a live booking or is not after now. Price is the student's custom price,
	 * else the lesson type's. `through` (yyyy-MM-dd) becomes materializedThrough. Throws
	 * AccountStoreError not_found (unknown student), then BookingStoreError lesson_type_not_found.
	 */
	createSeries(
		input: SeriesInput,
		startsAt: Date[],
		through: string,
		now: Date
	): Promise<{ series: LessonSeries; occurrences: OccurrenceResult[] }>;
	/** Same skipping rules as createSeries. Throws SeriesStoreError not_found; ended. */
	addSeriesOccurrences(
		seriesId: string,
		startsAt: Date[],
		through: string,
		now: Date
	): Promise<OccurrenceResult[]>;
	getSeries(id: string): Promise<LessonSeries | null>;
	/** Every series for the account's students, newest first. */
	listSeriesForAccount(accountId: string): Promise<LessonSeries[]>;
	/** All the series' bookings, any status, startsAt ascending. */
	listSeriesBookings(seriesId: string): Promise<AdminBooking[]>;
	/** Series not ended whose materializedThrough is null or before `through`. */
	listSeriesNeedingTopUp(through: string): Promise<LessonSeries[]>;
	/**
	 * Sets endedAt (kept if already set) and cancels live occurrences with startsAt >= from and
	 * > now, never late. Returns the cancelled bookings. Throws SeriesStoreError not_found.
	 */
	endSeries(id: string, from: Date, now: Date): Promise<AdminBooking[]>;
}

/** Where a song is for the student: still learning it, ready to perform, or done with it. */
export type SongStatus = 'learning' | 'ready' | 'past';

export interface SongInput {
	title: string;
	/** Composer or artist; '' when unknown. */
	artist: string;
	status: SongStatus;
	notes: string;
}

/** A song on a student's repertoire list. Just the list: no sheet music is stored. */
export interface RepertoireSong extends SongInput {
	id: string;
	studentId: string;
	createdAt: Date;
}

export interface RepertoireStore {
	/** Every song for these students, by title. */
	listRepertoire(studentIds: string[]): Promise<RepertoireSong[]>;
	/** Trims text fields. Throws AccountStoreError not_found (unknown student). */
	addSong(studentId: string, input: SongInput): Promise<RepertoireSong>;
	/** Trims text fields. Throws AccountStoreError not_found (not this student's song). */
	updateSong(studentId: string, songId: string, input: SongInput): Promise<RepertoireSong>;
	/** Throws AccountStoreError not_found (not this student's song). */
	deleteSong(studentId: string, songId: string): Promise<void>;
}

export type AppStore = BookingStore & AdminStore & AccountStore & SeriesStore & RepertoireStore;
