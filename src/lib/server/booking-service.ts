import { DateTime } from 'luxon';
import {
	getAvailableSlots,
	type BookingRules,
	type Interval,
	type SlotsByDate
} from './availability';
import { newRequestEmail, requestReceivedEmail, type BookingEmailData } from './email/templates';
import type { Mailer } from './email/mailer';
import { formatDateTime, formatMoney, formatTime } from './format';
import { displayPriceCents } from './pricing';
import {
	AccountStoreError,
	BookingStoreError,
	type AppStore,
	type BookingStore,
	type BookingSummary,
	type LessonType,
	type StudioSettings
} from './store/types';

export interface LessonTypeView {
	id: string;
	name: string;
	description: string;
	durationMin: number;
	priceLabel: string;
}

export interface MonthAvailability {
	timezone: string;
	month: string;
	lessonType: LessonTypeView;
	days: Record<string, { iso: string; label: string }[]>;
}

export interface GuestRequestForm {
	lessonTypeId: string;
	startsAt: string;
	accountName: string;
	email: string;
	studentName: string;
	note: string;
}

/** `form` is a request-level error that is not about any one field (for example, the pending limit). */
export type FormField =
	'accountName' | 'email' | 'studentName' | 'studentId' | 'note' | 'startsAt' | 'form';
export type SubmitResult =
	{ ok: true; manageToken: string } | { ok: false; errors: Partial<Record<FormField, string>> };

export interface ServiceDeps {
	store: BookingStore;
	mailer: Mailer;
	appUrl: string;
}

const DAY_MS = 86_400_000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UNAVAILABLE = 'Sorry, that time is no longer available. Please pick another.';

export interface StudentChoice {
	accountId: string;
	studentId: string;
}

/** A student's custom prices by lesson type, once the student is confirmed to be the account's. */
type PriceMap = Map<string, number>;

function toView(t: LessonType, student?: StudentChoice, prices?: PriceMap): LessonTypeView {
	const priceCents = displayPriceCents(
		student ? { kind: 'account', accountId: student.accountId } : { kind: 'guest' },
		{
			listPriceCents: t.priceCents,
			studentAccountId: student?.accountId ?? null,
			customPriceCents: prices?.get(t.id) ?? null
		}
	);
	return {
		id: t.id,
		name: t.name,
		description: t.description,
		durationMin: t.durationMin,
		priceLabel: formatMoney(priceCents)
	};
}

function toRules(s: StudioSettings): BookingRules {
	return {
		timezone: s.timezone,
		minNoticeHours: s.minNoticeHours,
		maxAdvanceDays: s.maxAdvanceDays,
		slotIncrementMin: s.slotIncrementMin,
		bufferMin: s.bufferMin,
		allowSameDay: s.allowSameDay
	};
}

/** Slots for an inclusive date range, against current weekly hours, overrides and live bookings. */
async function slotsForRange(
	store: BookingStore,
	settings: StudioSettings,
	durationMin: number,
	fromDate: string,
	toDate: string,
	now: Date
): Promise<SlotsByDate> {
	const zone = settings.timezone;
	const rangeStart = DateTime.fromISO(fromDate, { zone }).startOf('day').toJSDate();
	const rangeEnd = DateTime.fromISO(toDate, { zone }).plus({ days: 1 }).startOf('day').toJSDate();
	const [hours, overrides, live] = await Promise.all([
		store.getWeeklyHours(),
		store.getDateOverrides(fromDate, toDate),
		store.getLiveBookings(
			new Date(rangeStart.getTime() - DAY_MS),
			new Date(rangeEnd.getTime() + DAY_MS)
		)
	]);
	const busy: Interval[] = live.map((b) => ({
		start: b.startsAt,
		end: b.endsAt,
		blockedUntil: b.blockedUntil
	}));
	return getAvailableSlots(
		{ durationMin, fromDate, toDate, now },
		toRules(settings),
		hours,
		overrides,
		busy
	);
}

export async function listLessonTypes(store: BookingStore): Promise<LessonTypeView[]> {
	return (await store.getActiveLessonTypes()).map((t) => toView(t));
}

/** Null when the student does not belong to the account. */
async function loadStudentPrices(
	store: AppStore,
	student: StudentChoice
): Promise<PriceMap | null> {
	const owned = (await store.listStudents(student.accountId)).some(
		(s) => s.id === student.studentId
	);
	if (!owned) return null;
	const prices = await store.listStudentPrices([student.studentId]);
	return new Map(prices.map((p) => [p.lessonTypeId, p.priceCents]));
}

export async function listLessonTypesFor(
	store: AppStore,
	student: StudentChoice | null
): Promise<LessonTypeView[] | null> {
	if (!student) return listLessonTypes(store);
	const prices = await loadStudentPrices(store, student);
	if (!prices) return null;
	return (await store.getActiveLessonTypes()).map((t) => toView(t, student, prices));
}

export async function getMonthAvailability(
	store: AppStore,
	lessonTypeId: string,
	month: string,
	now: Date,
	student?: StudentChoice
): Promise<MonthAvailability | null> {
	if (!/^\d{4}-\d{2}$/.test(month)) return null;
	const lessonType = (await store.getActiveLessonTypes()).find((t) => t.id === lessonTypeId);
	if (!lessonType) return null;
	let prices: PriceMap | undefined;
	if (student) {
		const owned = await loadStudentPrices(store, student);
		if (!owned) return null;
		prices = owned;
	}
	const settings = await store.getSettings();
	const zone = settings.timezone;
	const first = DateTime.fromISO(`${month}-01`, { zone });
	if (!first.isValid) return null;

	const byDate = await slotsForRange(
		store,
		settings,
		lessonType.durationMin,
		first.toISODate()!,
		first.endOf('month').toISODate()!,
		now
	);
	const days: MonthAvailability['days'] = {};
	for (const [date, isos] of Object.entries(byDate)) {
		days[date] = isos.map((iso) => ({ iso, label: formatTime(new Date(iso), zone) }));
	}
	return { timezone: zone, month, lessonType: toView(lessonType, student, prices), days };
}

type SlotCheck =
	| { ok: true; lessonType: LessonType; startsAt: Date }
	| { ok: false; errors: Partial<Record<FormField, string>> };

/** The lesson type must be active and the start time one of the currently offered slots. */
async function validateRequestedSlot(
	store: BookingStore,
	settings: StudioSettings,
	lessonTypeId: string,
	startsAtIso: string,
	now: Date
): Promise<SlotCheck> {
	const lessonType = (await store.getActiveLessonTypes()).find((t) => t.id === lessonTypeId);
	if (!lessonType) {
		return { ok: false, errors: { startsAt: 'That lesson type is no longer available.' } };
	}
	const startsAt = new Date(startsAtIso);
	if (Number.isNaN(startsAt.getTime())) return { ok: false, errors: { startsAt: UNAVAILABLE } };
	const date = DateTime.fromJSDate(startsAt, { zone: settings.timezone }).toISODate()!;
	const offered = await slotsForRange(store, settings, lessonType.durationMin, date, date, now);
	if (!offered[date]?.includes(startsAt.toISOString())) {
		return { ok: false, errors: { startsAt: UNAVAILABLE } };
	}
	return { ok: true, lessonType, startsAt };
}

/** Null when the error is not a BookingStoreError. */
function mapBookingStoreError(
	e: unknown,
	tooManyPendingKey: FormField
): { ok: false; errors: Partial<Record<FormField, string>> } | null {
	if (!(e instanceof BookingStoreError)) return null;
	if (e.code === 'slot_taken') return { ok: false, errors: { startsAt: UNAVAILABLE } };
	if (e.code === 'too_many_pending') {
		return {
			ok: false,
			errors: {
				[tooManyPendingKey]:
					'You already have 2 lesson requests waiting for approval. Please wait for a reply before requesting more.'
			}
		};
	}
	return { ok: false, errors: { startsAt: 'That lesson type is no longer available.' } };
}

async function sendRequestEmails(
	{ mailer, appUrl }: ServiceDeps,
	settings: StudioSettings,
	data: BookingEmailData
): Promise<void> {
	try {
		await mailer.send(requestReceivedEmail(data));
	} catch (e) {
		console.error('Failed to send request-received email', e);
	}
	if (settings.adminEmail) {
		try {
			await mailer.send(newRequestEmail(data, settings.adminEmail, `${appUrl}/admin`));
		} catch (e) {
			console.error('Failed to send new-request email', e);
		}
	}
}

export async function submitGuestRequest(
	deps: ServiceDeps,
	form: GuestRequestForm,
	now: Date
): Promise<SubmitResult> {
	const { store, appUrl } = deps;
	const accountName = form.accountName.trim();
	const email = form.email.trim();
	const studentName = form.studentName.trim();
	const note = form.note.trim();

	const errors: Partial<Record<FormField, string>> = {};
	if (!accountName) errors.accountName = 'Please enter your name.';
	if (!EMAIL_PATTERN.test(email)) errors.email = 'Please enter a valid email address.';
	if (!studentName) errors.studentName = 'Please enter who the lesson is for.';
	if (note.length > 1000) errors.note = 'Notes must be 1000 characters or fewer.';
	if (Object.keys(errors).length > 0) return { ok: false, errors };

	const settings = await store.getSettings();
	const slot = await validateRequestedSlot(store, settings, form.lessonTypeId, form.startsAt, now);
	if (!slot.ok) return { ok: false, errors: slot.errors };
	const { lessonType, startsAt } = slot;

	let created;
	try {
		created = await store.requestGuestBooking(
			{ email, accountName, studentName, lessonTypeId: lessonType.id, startsAt, note },
			now
		);
	} catch (e) {
		const mapped = mapBookingStoreError(e, 'email');
		if (mapped) return mapped;
		throw e;
	}

	const data: BookingEmailData = {
		accountName,
		email,
		studentName,
		lessonTypeName: lessonType.name,
		durationMin: lessonType.durationMin,
		startsAt: created.startsAt,
		timezone: settings.timezone,
		priceCents: created.priceCents,
		note,
		manageUrl: `${appUrl}/manage/${created.manageToken}`
	};
	await sendRequestEmails(deps, settings, data);
	return { ok: true, manageToken: created.manageToken };
}

export async function getManageView(
	store: BookingStore,
	token: string
): Promise<(BookingSummary & { timezone: string; whenLabel: string; priceLabel: string }) | null> {
	const booking = await store.getBookingByManageToken(token);
	if (!booking) return null;
	const { timezone } = await store.getSettings();
	return {
		...booking,
		timezone,
		whenLabel: formatDateTime(booking.startsAt, timezone),
		priceLabel: formatMoney(booking.priceCents)
	};
}

export interface AccountRequestForm {
	lessonTypeId: string;
	startsAt: string;
	studentId: string;
	note: string;
}

export async function submitAccountRequest(
	deps: ServiceDeps & { store: AppStore },
	accountId: string,
	form: AccountRequestForm,
	now: Date
): Promise<SubmitResult> {
	const { store, appUrl } = deps;
	const note = form.note.trim();
	if (note.length > 1000) {
		return { ok: false, errors: { note: 'Notes must be 1000 characters or fewer.' } };
	}

	const student = (await store.listStudents(accountId)).find((s) => s.id === form.studentId);
	const account = await store.findAccountById(accountId);
	if (!student || !account) {
		return { ok: false, errors: { studentId: 'Choose who the lesson is for.' } };
	}

	const settings = await store.getSettings();
	const slot = await validateRequestedSlot(store, settings, form.lessonTypeId, form.startsAt, now);
	if (!slot.ok) return { ok: false, errors: slot.errors };
	const { lessonType, startsAt } = slot;

	let created;
	try {
		created = await store.requestAccountBooking(
			{ accountId, studentId: student.id, lessonTypeId: lessonType.id, startsAt, note },
			now
		);
	} catch (e) {
		if (e instanceof AccountStoreError) {
			return { ok: false, errors: { studentId: 'Choose who the lesson is for.' } };
		}
		// The pending limit is about the family, not this time: picking another slot would not help.
		const mapped = mapBookingStoreError(e, 'form');
		if (mapped) return mapped;
		throw e;
	}

	const data: BookingEmailData = {
		accountName: account.name,
		email: account.email,
		studentName: student.name,
		lessonTypeName: lessonType.name,
		durationMin: lessonType.durationMin,
		startsAt: created.startsAt,
		timezone: settings.timezone,
		priceCents: created.priceCents,
		note,
		manageUrl: `${appUrl}/manage/${created.manageToken}`
	};
	await sendRequestEmails(deps, settings, data);
	return { ok: true, manageToken: created.manageToken };
}
