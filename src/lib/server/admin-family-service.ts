import { DateTime } from 'luxon';
import type { AdminDeps } from './admin-service';
import type { Result } from './admin-validation';
import { addLessonToCalendar } from './calendar/sync';
import { bookingApprovedEmail, familyInviteEmail } from './email/templates';
import { formatDateTime } from './format';
import { localToday } from './recurrence';
import { assessDates, DATE_STATUS_LABELS } from './series-service';
import {
	AccountStoreError,
	BookingStoreError,
	type AccountWithStudents,
	type AppStore
} from './store/types';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_NAME = 100;
const MAX_NOTE = 1000;

function nameError(name: string, what: string): string | null {
	if (!name) return `Enter ${what}.`;
	if (name.length > MAX_NAME) return `Keep the name under ${MAX_NAME} characters.`;
	return null;
}

/** A family the admin can still change: a client account that has not been deleted. */
async function liveFamily(store: AppStore, accountId: string): Promise<AccountWithStudents | null> {
	const account = await store.getAccount(accountId);
	return account && account.role === 'client' && !account.deleted ? account : null;
}

// ---- Families and students ----

export interface FamilyForm {
	name: string;
	email: string;
	/** Optional first student. */
	studentName: string;
	/** Email the parent a link to choose a password. */
	invite: boolean;
}

/**
 * Creates a family with no password, and its first student when named. The parent claims the
 * account by registering (the invite links there) or resetting the password with this email.
 */
export async function createFamily(
	deps: AdminDeps,
	form: FamilyForm
): Promise<Result<{ accountId: string }>> {
	const { store, mailer, appUrl } = deps;
	const name = form.name.trim();
	const email = form.email.trim().toLowerCase();
	const studentName = form.studentName.trim();
	const errors: Record<string, string> = {};
	const badName = nameError(name, "the parent's name");
	if (badName) errors.name = badName;
	if (!email) errors.email = 'Enter an email address.';
	else if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
		errors.email = 'Enter a valid email address.';
	}
	if (studentName.length > MAX_NAME) {
		errors.studentName = `Keep the name under ${MAX_NAME} characters.`;
	}
	if (Object.keys(errors).length > 0) return { ok: false, errors };

	let accountId: string;
	try {
		accountId = (await store.createAccount(name, email)).id;
	} catch (e) {
		if (e instanceof AccountStoreError && e.code === 'duplicate_email') {
			return { ok: false, errors: { email: 'A family with this email already exists.' } };
		}
		throw e;
	}
	if (studentName) await store.addStudent(accountId, studentName);

	if (form.invite) {
		try {
			const url = `${appUrl}/register?${new URLSearchParams({ email })}`;
			await mailer.send(familyInviteEmail(email, name, url));
		} catch (e) {
			console.error('Failed to send family invite email', e);
		}
	}
	return { ok: true, value: { accountId } };
}

export async function addFamilyStudent(
	store: AppStore,
	accountId: string,
	name: string
): Promise<Result<{ studentId: string }>> {
	const trimmed = name.trim();
	const invalid = nameError(trimmed, "the student's name");
	if (invalid) return { ok: false, errors: { name: invalid } };
	if (!(await liveFamily(store, accountId))) {
		return { ok: false, errors: { form: 'Family not found.' } };
	}
	try {
		return { ok: true, value: { studentId: (await store.addStudent(accountId, trimmed)).id } };
	} catch (e) {
		if (e instanceof AccountStoreError && e.code === 'duplicate_student') {
			return { ok: false, errors: { name: 'This family already has a student with that name.' } };
		}
		throw e;
	}
}

// ---- Booking for a student ----

/** Raw form fields; every value is the submitted string. */
export interface AdminBookingForm {
	studentId: string;
	lessonTypeId: string;
	/** yyyy-MM-dd, studio local */
	date: string;
	/** HH:mm, studio local */
	time: string;
	note: string;
	/** 'on' emails the family the confirmation; anything else books quietly. */
	notify: string;
}

export const ADMIN_BOOKING_FORM_FIELDS: (keyof AdminBookingForm)[] = [
	'studentId',
	'lessonTypeId',
	'date',
	'time',
	'note',
	'notify'
];

export type AdminBookingResult =
	| { ok: true; bookingId: string; whenLabel: string; studentName: string }
	| { ok: false; errors: Record<string, string> };

/**
 * The admin books one lesson for a family's student. Like recurring lessons it is confirmed at
 * once and ignores the public booking rules (notice, advance window, weekly hours, the pending
 * limit, Turnstile), but not real clashes: live bookings, closed dates and Google Calendar busy
 * time. The family gets the usual confirmation email (unless `notify` is off) and the lesson goes
 * on the calendar.
 */
export async function bookForStudent(
	deps: AdminDeps,
	accountId: string,
	form: AdminBookingForm,
	now: Date
): Promise<AdminBookingResult> {
	const { store, mailer, appUrl } = deps;
	const settings = await store.getSettings();
	const zone = settings.timezone;

	const errors: Record<string, string> = {};
	if (!form.studentId) errors.studentId = 'Choose a student.';
	if (!form.lessonTypeId) errors.lessonTypeId = 'Choose a lesson type.';
	const date = form.date.trim();
	const time = form.time.trim();
	if (!DATE_PATTERN.test(date) || !DateTime.fromISO(date).isValid) errors.date = 'Choose a date.';
	if (!TIME_PATTERN.test(time)) errors.time = 'Use a time like 15:00.';
	const note = form.note.trim();
	if (note.length > MAX_NOTE) errors.note = 'Notes must be 1000 characters or fewer.';
	let startsAt: Date | null = null;
	if (!errors.date && !errors.time) {
		const local = DateTime.fromISO(`${date}T${time}`, { zone });
		// A time skipped by a daylight-saving change moves forward; refuse it instead.
		if (!local.isValid || local.toFormat('yyyy-MM-dd HH:mm') !== `${date} ${time}`) {
			errors.time = 'That time does not exist on this date (clocks change).';
		} else if (local.toMillis() <= now.getTime()) {
			errors[date < localToday(now, zone) ? 'date' : 'time'] = 'That time has already passed.';
		} else startsAt = local.toJSDate();
	}
	if (Object.keys(errors).length > 0 || !startsAt) return { ok: false, errors };

	const family = await liveFamily(store, accountId);
	const student = family?.students.find((s) => s.id === form.studentId);
	if (!family || !student) return { ok: false, errors: { studentId: 'Student not found.' } };
	const lessonType = (await store.getActiveLessonTypes()).find((t) => t.id === form.lessonTypeId);
	if (!lessonType) return { ok: false, errors: { lessonTypeId: 'Choose an active lesson type.' } };

	const [assessed] = await assessDates(
		deps,
		settings,
		lessonType.durationMin,
		[{ date, startsAt }],
		now
	);
	if (assessed.status !== 'ok') {
		return {
			ok: false,
			errors: { form: `Can't book then: ${DATE_STATUS_LABELS[assessed.status]}.` }
		};
	}

	let bookingId: string;
	try {
		bookingId = (
			await store.createApprovedBooking(
				{ accountId, studentId: student.id, lessonTypeId: lessonType.id, startsAt, note },
				now
			)
		).bookingId;
	} catch (e) {
		if (e instanceof AccountStoreError)
			return { ok: false, errors: { studentId: 'Student not found.' } };
		if (e instanceof BookingStoreError) {
			return e.code === 'slot_taken'
				? { ok: false, errors: { form: `Can't book then: ${DATE_STATUS_LABELS.clash}.` } }
				: { ok: false, errors: { lessonTypeId: 'Choose an active lesson type.' } };
		}
		throw e;
	}

	// The booking has committed: from here on failures only log.
	const booking = await store.getBooking(bookingId);
	if (booking && form.notify === 'on') {
		try {
			await mailer.send(
				bookingApprovedEmail(
					{
						accountName: booking.accountName,
						email: booking.accountEmail,
						studentName: booking.studentName,
						lessonTypeName: booking.lessonTypeName,
						durationMin: booking.durationMin,
						startsAt: booking.startsAt,
						timezone: zone,
						priceCents: booking.priceCents,
						note: booking.note,
						manageUrl: `${appUrl}/manage/${booking.manageToken}`
					},
					booking.id,
					now
				)
			);
		} catch (e) {
			console.error('Failed to send booking confirmed email', e);
		}
	}
	if (booking) await addLessonToCalendar(deps, booking, settings);
	return {
		ok: true,
		bookingId,
		whenLabel: formatDateTime(startsAt, zone),
		studentName: student.name
	};
}
