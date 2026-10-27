import {
	cancellationConfirmationEmail,
	cancellationNoticeEmail,
	type BookingEmailData
} from './email/templates';
import { removeLessonFromCalendar } from './calendar/sync';
import type { EmailMessage } from './email/mailer';
import { formatDateTime, formatMoney } from './format';
import { cadenceLabel } from './recurrence';
import type { ServiceDeps } from './booking-service';
import {
	AccountStoreError,
	type AdminBooking,
	type AppStore,
	type BookingStatus,
	type CancelTarget,
	type Student
} from './store/types';

export interface AccountBookingView {
	id: string;
	status: BookingStatus;
	statusLabel: string;
	whenLabel: string;
	lessonTypeName: string;
	studentName: string;
	priceLabel: string;
	lateCancel: boolean;
	canCancel: boolean;
	/** "Weekly" or "Every 2 weeks" for a recurring lesson. */
	seriesLabel: string | null;
}

export type FieldResult = { ok: true } | { ok: false; errors: Record<string, string> };
export type AddStudentResult =
	{ ok: true; student: Student } | { ok: false; errors: Record<string, string> };

export interface CancelView {
	booking: AccountBookingView & { durationMin: number };
	late: boolean;
	cutoffHours: number;
	policyText: string;
}

const HOUR_MS = 3_600_000;

const STATUS_LABELS: Record<BookingStatus, string> = {
	pending: 'Pending approval',
	approved: 'Confirmed',
	declined: 'Declined',
	cancelled: 'Cancelled',
	expired: 'Expired'
};

export const LATE_CANCEL_WARNING = (cutoffHours: number): string =>
	`This is less than ${cutoffHours} hours before your lesson, so it falls outside our cancellation policy and you may still be charged.`;

/** Only approved lessons can be late; exactly at the cutoff is not late. */
export function isLateCancel(
	status: BookingStatus,
	startsAt: Date,
	now: Date,
	cutoffHours: number
): boolean {
	return status === 'approved' && startsAt.getTime() - now.getTime() < cutoffHours * HOUR_MS;
}

function isLive(b: AdminBooking): boolean {
	return b.status === 'pending' || b.status === 'approved';
}

function toView(b: AdminBooking, now: Date, timezone: string): AccountBookingView {
	return {
		id: b.id,
		status: b.status,
		statusLabel: STATUS_LABELS[b.status],
		whenLabel: formatDateTime(b.startsAt, timezone),
		lessonTypeName: b.lessonTypeName,
		studentName: b.studentName,
		priceLabel: formatMoney(b.priceCents),
		lateCancel: b.lateCancel,
		canCancel: isLive(b) && b.startsAt.getTime() > now.getTime(),
		seriesLabel: b.series ? cadenceLabel(b.series.intervalWeeks) : null
	};
}

export async function getAccountHome(
	store: AppStore,
	accountId: string,
	now: Date
): Promise<{ students: Student[]; upcoming: AccountBookingView[]; past: AccountBookingView[] }> {
	const [students, bookings, settings] = await Promise.all([
		store.listStudents(accountId),
		store.listAccountBookings(accountId),
		store.getSettings()
	]);
	const view = (b: AdminBooking) => toView(b, now, settings.timezone);
	const isUpcoming = (b: AdminBooking) => isLive(b) && b.startsAt.getTime() >= now.getTime();
	const byStart = (a: AdminBooking, b: AdminBooking) => a.startsAt.getTime() - b.startsAt.getTime();
	return {
		students,
		upcoming: bookings.filter(isUpcoming).sort(byStart).map(view),
		past: bookings
			.filter((b) => !isUpcoming(b))
			.sort((a, b) => byStart(b, a))
			.map(view)
	};
}

function validateName(name: string): string | null {
	if (!name) return 'Enter a name.';
	if (name.length > 100) return 'Keep the name under 100 characters.';
	return null;
}

function studentError(e: unknown): { ok: false; errors: Record<string, string> } {
	if (e instanceof AccountStoreError) {
		if (e.code === 'duplicate_student') {
			return { ok: false, errors: { name: 'You already have a student with that name.' } };
		}
		if (e.code === 'not_found') return { ok: false, errors: { name: 'Student not found.' } };
	}
	throw e;
}

export async function addMyStudent(
	store: AppStore,
	accountId: string,
	name: string
): Promise<AddStudentResult> {
	const trimmed = name.trim();
	const invalid = validateName(trimmed);
	if (invalid) return { ok: false, errors: { name: invalid } };
	try {
		return { ok: true, student: await store.addStudent(accountId, trimmed) };
	} catch (e) {
		return studentError(e);
	}
}

export async function renameMyStudent(
	store: AppStore,
	accountId: string,
	studentId: string,
	name: string
): Promise<FieldResult> {
	const trimmed = name.trim();
	const invalid = validateName(trimmed);
	if (invalid) return { ok: false, errors: { name: invalid } };
	try {
		await store.renameStudent(accountId, studentId, trimmed);
		return { ok: true };
	} catch (e) {
		return studentError(e);
	}
}

/** Never includes the account's name or email: manage-link holders have not proven ownership. */
export async function getCancelView(
	store: AppStore,
	target: CancelTarget,
	now: Date
): Promise<CancelView | null> {
	const booking = await store.getBookingByTarget(target);
	if (!booking) return null;
	const settings = await store.getSettings();
	return {
		booking: {
			...toView(booking, now, settings.timezone),
			durationMin: booking.durationMin
		},
		late: isLateCancel(booking.status, booking.startsAt, now, settings.cancelCutoffHours),
		cutoffHours: settings.cancelCutoffHours,
		policyText: settings.cancellationPolicyText
	};
}

export const LATE_CHANGED_MESSAGE =
	'Please review: this cancellation is now inside the cancellation policy.';

export type CancelResult =
	{ ok: true; late: boolean } | { ok: false; message: string; lateChanged?: true };

/**
 * `expectedLate` is whether the page showed the late warning. Lateness is decided at submit, so
 * when it no longer matches what the family saw, nothing is cancelled and the page re-renders
 * with the current warning.
 */
export async function cancelLesson(
	deps: ServiceDeps & { store: AppStore },
	target: CancelTarget,
	now: Date,
	expectedLate?: boolean
): Promise<CancelResult> {
	const { store, mailer, appUrl } = deps;
	const existing = await store.getBookingByTarget(target);
	if (!existing) return { ok: false, message: 'Booking not found.' };
	const settings = await store.getSettings();
	const late = isLateCancel(existing.status, existing.startsAt, now, settings.cancelCutoffHours);
	if (expectedLate !== undefined && expectedLate !== late) {
		return { ok: false, message: LATE_CHANGED_MESSAGE, lateChanged: true };
	}

	let booking: AdminBooking;
	try {
		booking = await store.cancelBooking(target, late, now);
	} catch (e) {
		if (e instanceof AccountStoreError) {
			if (e.code === 'not_found') return { ok: false, message: 'Booking not found.' };
			if (e.code === 'not_cancellable') {
				return { ok: false, message: 'This lesson can no longer be cancelled online.' };
			}
		}
		throw e;
	}

	const send = async (msg: EmailMessage) => {
		try {
			await mailer.send(msg);
		} catch (e) {
			console.error('Failed to send cancellation email', e);
		}
	};
	try {
		const account =
			target.kind === 'account' ? await store.findAccountById(target.accountId) : null;
		const data: BookingEmailData = {
			accountName: account?.name ?? booking.accountName,
			email: account?.email ?? booking.accountEmail,
			studentName: booking.studentName,
			lessonTypeName: booking.lessonTypeName,
			durationMin: booking.durationMin,
			startsAt: booking.startsAt,
			timezone: settings.timezone,
			priceCents: booking.priceCents,
			note: booking.note,
			manageUrl: `${appUrl}/manage/${booking.manageToken}`
		};
		await send(cancellationConfirmationEmail(data));
		if (settings.adminEmail) {
			await send(
				cancellationNoticeEmail(
					data,
					settings.adminEmail,
					`${appUrl}/admin/lessons`,
					late,
					settings.cancelCutoffHours
				)
			);
		}
	} catch (e) {
		console.error('Failed to build cancellation emails', e);
	}
	try {
		await removeLessonFromCalendar(deps, existing, settings);
	} catch (e) {
		console.error('Failed to remove lesson from Google Calendar', e);
	}
	return { ok: true, late };
}
