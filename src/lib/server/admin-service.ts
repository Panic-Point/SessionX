import {
	bookingApprovedEmail,
	bookingDeclinedEmail,
	type BookingEmailData
} from './email/templates';
import type { Mailer } from './email/mailer';
import { formatDateTime, formatMoney } from './format';
import { AdminStoreError, type AdminBooking, type AppStore } from './store/types';

export type AdminDataStore = AppStore;

export interface AdminDeps {
	store: AdminDataStore;
	mailer: Mailer;
	appUrl: string;
}

export interface AdminBookingView extends AdminBooking {
	whenLabel: string;
	priceLabel: string;
	paid: boolean;
}

export type ActionResult = { ok: true } | { ok: false; message: string };

const MAX_REASON = 500;

const STORE_MESSAGES: Record<AdminStoreError['code'], string> = {
	not_pending: 'This request was already handled.',
	in_past: 'This lesson time has already passed.',
	not_found: 'Booking not found.'
};

function toView(b: AdminBooking, timezone: string): AdminBookingView {
	return {
		...b,
		whenLabel: formatDateTime(b.startsAt, timezone),
		priceLabel: formatMoney(b.priceCents),
		paid: b.paidAt !== null
	};
}

export async function listPendingRequests(
	store: AdminDataStore,
	now: Date
): Promise<AdminBookingView[]> {
	const { timezone } = await store.getSettings();
	const rows = await store.listBookings({ statuses: ['pending'], from: now, order: 'asc' });
	return rows.map((b) => toView(b, timezone));
}

export async function listLessons(
	store: AdminDataStore,
	opts: { range: 'upcoming' | 'past'; unpaidOnly: boolean },
	now: Date
): Promise<AdminBookingView[]> {
	const { timezone } = await store.getSettings();
	const rows = await store.listBookings(
		opts.range === 'upcoming'
			? { statuses: ['approved'], from: now, unpaidOnly: opts.unpaidOnly, order: 'asc' }
			: { statuses: ['approved'], to: now, unpaidOnly: opts.unpaidOnly, order: 'desc' }
	);
	return rows.map((b) => toView(b, timezone));
}

export async function decideRequest(
	deps: AdminDeps,
	id: string,
	decision: 'approved' | 'declined',
	reason: string,
	now: Date
): Promise<ActionResult> {
	const { store, mailer, appUrl } = deps;
	const trimmed = reason.trim();
	if (decision === 'declined' && trimmed.length > MAX_REASON) {
		return { ok: false, message: 'Reason must be 500 characters or fewer.' };
	}
	const storedReason = decision === 'declined' && trimmed ? trimmed : null;

	let booking: AdminBooking;
	try {
		booking = await store.decideBooking(id, decision, storedReason, now);
	} catch (e) {
		if (e instanceof AdminStoreError) return { ok: false, message: STORE_MESSAGES[e.code] };
		throw e;
	}

	// The decision has committed: from here on a failure (settings read, email) must only log, or
	// a retry would report "already handled" and the family would never be emailed.
	try {
		const { timezone } = await store.getSettings();
		const data: BookingEmailData = {
			accountName: booking.accountName,
			email: booking.accountEmail,
			studentName: booking.studentName,
			lessonTypeName: booking.lessonTypeName,
			durationMin: booking.durationMin,
			startsAt: booking.startsAt,
			timezone,
			priceCents: booking.priceCents,
			note: booking.note,
			manageUrl: `${appUrl}/manage/${booking.manageToken}`
		};
		await mailer.send(
			decision === 'approved'
				? bookingApprovedEmail(data, booking.id, now)
				: bookingDeclinedEmail(data, storedReason)
		);
	} catch (e) {
		console.error(`Failed to send booking ${decision} email`, e);
	}
	return { ok: true };
}

export async function setLessonPaid(
	store: AdminDataStore,
	id: string,
	paid: boolean,
	now: Date
): Promise<ActionResult> {
	try {
		await store.setPaid(id, paid ? now : null);
		return { ok: true };
	} catch (e) {
		if (e instanceof AdminStoreError && e.code === 'not_found') {
			return { ok: false, message: STORE_MESSAGES.not_found };
		}
		throw e;
	}
}
