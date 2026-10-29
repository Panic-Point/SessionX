import {
	bookingApprovedEmail,
	bookingDeclinedEmail,
	type BookingEmailData
} from './email/templates';
import { addLessonToCalendar } from './calendar/sync';
import type { CalendarClient } from './calendar/types';
import type { Mailer } from './email/mailer';
import { formatDateTime, formatMoney } from './format';
import { seriesLabel } from './recurrence';
import { dollarsToCents, type Result } from './admin-validation';
import {
	AccountStoreError,
	AdminStoreError,
	type AdminBooking,
	type BookingFilter,
	type AppStore,
	type StudioSettings
} from './store/types';

export type AdminDataStore = AppStore;

export interface AdminDeps {
	store: AdminDataStore;
	mailer: Mailer;
	appUrl: string;
	calendar?: CalendarClient;
}

export interface AdminBookingView extends AdminBooking {
	whenLabel: string;
	priceLabel: string;
	paid: boolean;
	/** e.g. "Weekly · Tue 3:00pm" for an occurrence of a recurring series. */
	seriesLabel: string | null;
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
		paid: b.paidAt !== null,
		seriesLabel: b.series ? seriesLabel(b.series) : null
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
	opts: {
		range: 'upcoming' | 'past' | 'late-cancels';
		unpaidOnly: boolean;
		/** A chosen week, month or custom range: replaces upcoming/past, ascending by time. */
		period?: { from: Date; to: Date } | null;
	},
	now: Date
): Promise<AdminBookingView[]> {
	const { timezone } = await store.getSettings();
	const period = opts.period ?? null;
	let filter: BookingFilter;
	if (opts.range === 'late-cancels') {
		filter = period
			? { statuses: ['cancelled'], lateCancelOnly: true, ...period, order: 'asc' }
			: { statuses: ['cancelled'], lateCancelOnly: true, order: 'desc' };
	} else if (period) {
		filter = { statuses: ['approved'], ...period, unpaidOnly: opts.unpaidOnly, order: 'asc' };
	} else if (opts.range === 'upcoming') {
		filter = { statuses: ['approved'], from: now, unpaidOnly: opts.unpaidOnly, order: 'asc' };
	} else {
		filter = { statuses: ['approved'], to: now, unpaidOnly: opts.unpaidOnly, order: 'desc' };
	}
	const rows = await store.listBookings(filter);
	return rows.map((b) => toView(b, timezone));
}

/** A family's confirmed lessons that have not started yet, soonest first. */
export async function listFamilyUpcomingLessons(
	store: AdminDataStore,
	accountId: string,
	now: Date
): Promise<AdminBookingView[]> {
	const [{ timezone }, rows] = await Promise.all([
		store.getSettings(),
		store.listAccountBookings(accountId, { from: now })
	]);
	return rows
		.filter((b) => b.status === 'approved' && b.startsAt.getTime() > now.getTime())
		.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
		.map((b) => toView(b, timezone));
}

/** e.g. "12 lessons · $420.00, $90.00 unpaid" for the lessons on the page. */
export function summarizeLessons(lessons: AdminBookingView[], lateCancels = false): string {
	const n = lessons.length;
	const noun = lateCancels
		? n === 1
			? 'late cancellation'
			: 'late cancellations'
		: n === 1
			? 'lesson'
			: 'lessons';
	const total = lessons.reduce((sum, l) => sum + l.priceCents, 0);
	const unpaid = lessons.filter((l) => !l.paid).reduce((sum, l) => sum + l.priceCents, 0);
	const unpaidPart = !lateCancels && unpaid > 0 ? `, ${formatMoney(unpaid)} unpaid` : '';
	return `${n} ${noun} · ${formatMoney(total)}${unpaidPart}`;
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
	let settings: StudioSettings | null = null;
	try {
		settings = await store.getSettings();
		const { timezone } = settings;
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
	// Without settings (already logged above) there is no write calendar to read, so skip.
	if (decision === 'approved' && settings) {
		try {
			await addLessonToCalendar(deps, booking, settings);
		} catch (e) {
			console.error('Failed to add lesson to Google Calendar', e);
		}
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

export interface FamilyListItem {
	id: string;
	name: string;
	/** '' once the family has deleted their account. */
	email: string;
	deleted: boolean;
	studentNames: string[];
}

export async function listFamilies(store: AdminDataStore): Promise<FamilyListItem[]> {
	const accounts = await store.listAccounts();
	return accounts
		.filter((a) => a.role === 'client')
		.map((a) => ({
			id: a.id,
			name: a.name,
			email: a.deleted ? '' : a.email,
			deleted: a.deleted,
			studentNames: a.students.map((s) => s.name)
		}));
}

export interface FamilyView {
	id: string;
	name: string;
	/** '' once the family has deleted their account. */
	email: string;
	deleted: boolean;
	adminNotes: string;
	students: {
		id: string;
		name: string;
		notes: string;
		prices: {
			lessonTypeId: string;
			lessonTypeName: string;
			listPriceLabel: string;
			/** Dollars like "30.00"; '' when the student has no custom price. */
			customPrice: string;
		}[];
	}[];
}

export async function getFamily(
	store: AdminDataStore,
	accountId: string
): Promise<FamilyView | null> {
	const account = await store.getAccount(accountId);
	if (!account || account.role !== 'client') return null;
	const types = [...(await store.listAllLessonTypes())].sort((a, b) => a.sortOrder - b.sortOrder);
	return {
		id: account.id,
		name: account.name,
		email: account.deleted ? '' : account.email,
		deleted: account.deleted,
		adminNotes: account.adminNotes,
		students: account.students.map((s) => ({
			id: s.id,
			name: s.name,
			notes: s.notes,
			prices: types.map((t) => {
				const custom = s.prices.find((p) => p.lessonTypeId === t.id);
				return {
					lessonTypeId: t.id,
					lessonTypeName: t.name,
					listPriceLabel: formatMoney(t.priceCents),
					customPrice: custom ? (custom.priceCents / 100).toFixed(2) : ''
				};
			})
		}))
	};
}

/** Validates every price first; saves nothing unless all are valid. */
export async function saveStudentPrices(
	store: AdminDataStore,
	studentId: string,
	form: Record<string, string>
): Promise<Result<null>> {
	const knownIds = new Set((await store.listAllLessonTypes()).map((t) => t.id));
	const errors: Record<string, string> = {};
	const updates: [string, number | null][] = [];
	for (const [lessonTypeId, raw] of Object.entries(form)) {
		if (!knownIds.has(lessonTypeId)) {
			errors[lessonTypeId] = 'Unknown lesson type.';
			continue;
		}
		if (raw.trim() === '') {
			updates.push([lessonTypeId, null]);
			continue;
		}
		const cents = dollarsToCents(raw);
		if (cents === null || cents > 100000) {
			errors[lessonTypeId] = 'Enter a price like 35 or 35.00.';
			continue;
		}
		updates.push([lessonTypeId, cents]);
	}
	if (Object.keys(errors).length > 0) return { ok: false, errors };

	try {
		for (const [lessonTypeId, cents] of updates) {
			await store.setStudentPrice(studentId, lessonTypeId, cents);
		}
	} catch (e) {
		if (e instanceof AccountStoreError && e.code === 'not_found') {
			return { ok: false, errors: { form: 'Student not found.' } };
		}
		throw e;
	}
	return { ok: true, value: null };
}

const MAX_NOTES = 2000;

async function saveNotes(
	notes: string,
	notFound: string,
	save: (notes: string) => Promise<void>
): Promise<Result<null>> {
	if (notes.trim().length > MAX_NOTES) {
		return { ok: false, errors: { notes: 'Keep notes under 2000 characters.' } };
	}
	try {
		await save(notes.trim());
	} catch (e) {
		if (e instanceof AccountStoreError && e.code === 'not_found') {
			return { ok: false, errors: { form: notFound } };
		}
		throw e;
	}
	return { ok: true, value: null };
}

export function saveAccountNotes(
	store: AdminDataStore,
	accountId: string,
	notes: string
): Promise<Result<null>> {
	return saveNotes(notes, 'Family not found.', (n) => store.updateAccountNotes(accountId, n));
}

export function saveStudentNotes(
	store: AdminDataStore,
	studentId: string,
	notes: string
): Promise<Result<null>> {
	return saveNotes(notes, 'Student not found.', (n) => store.updateStudentNotes(studentId, n));
}
