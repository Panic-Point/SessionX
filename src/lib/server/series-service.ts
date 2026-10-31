import { DateTime } from 'luxon';
import type { ActionResult } from './admin-service';
import type { Result } from './admin-validation';
import { addLessonToCalendar, calendarBusy, removeLessonFromCalendar } from './calendar/sync';
import type { CalendarClient } from './calendar/types';
import type { Mailer } from './email/mailer';
import {
	lessonCancelledByTeacherEmail,
	seriesCreatedEmail,
	seriesEndedEmail,
	type SeriesEmailData,
	type SkippedLesson
} from './email/templates';
import { formatDateTime, formatMoney } from './format';
import {
	HORIZON_DAYS,
	firstDate,
	lastDate,
	localToday,
	materialiseThrough,
	nextDate,
	occurrenceStarts,
	scheduleDescription,
	seriesLabel,
	type Occurrence,
	type RecurrenceRule
} from './recurrence';
import {
	AccountStoreError,
	BookingStoreError,
	SeriesStoreError,
	type AdminBooking,
	type AppStore,
	type BookingStatus,
	type LessonSeries,
	type SeriesInput,
	type StudioSettings
} from './store/types';

export interface SeriesDeps {
	store: AppStore;
	mailer: Mailer;
	appUrl: string;
	calendar?: CalendarClient;
}

/** What the preview says about one date. Only `ok` dates are booked; the rest are skipped. */
export type DateStatus = 'ok' | 'clash' | 'closed' | 'busy' | 'past';

export const DATE_STATUS_LABELS: Record<DateStatus, string> = {
	ok: 'OK',
	clash: 'Clashes with an existing lesson',
	closed: 'Studio closed that day',
	busy: 'Busy on Google Calendar',
	past: 'That time has already passed'
};

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_COUNT = 100;
const MAX_NOTE = 1000;

// ---- Form validation ----

/** Raw form fields; every value is the submitted string. */
export interface SeriesForm {
	studentId: string;
	lessonTypeId: string;
	weekday: string;
	startTime: string;
	intervalWeeks: string;
	startsOn: string;
	/** 'date' | 'count' | 'none' */
	endMode: string;
	endsOn: string;
	occurrenceCount: string;
	note: string;
	/** 'on' emails the family the dates; anything else books quietly. */
	notify: string;
}

export const SERIES_FORM_FIELDS: (keyof SeriesForm)[] = [
	'studentId',
	'lessonTypeId',
	'weekday',
	'startTime',
	'intervalWeeks',
	'startsOn',
	'endMode',
	'endsOn',
	'occurrenceCount',
	'note',
	'notify'
];

const isDate = (s: string) => DATE_PATTERN.test(s) && DateTime.fromISO(s).isValid;
const addDays = (date: string, days: number) =>
	DateTime.fromISO(date, { zone: 'utc' }).plus({ days }).toISODate()!;

/** Checks the shape of the rule; `today` is yyyy-MM-dd in the studio timezone. */
export function validateSeriesForm(form: SeriesForm, today: string): Result<SeriesInput> {
	const errors: Record<string, string> = {};
	if (!form.studentId) errors.studentId = 'Choose a student.';
	if (!form.lessonTypeId) errors.lessonTypeId = 'Choose a lesson type.';

	const weekday = Number(form.weekday);
	if (!/^[1-7]$/.test(form.weekday)) errors.weekday = 'Choose a day of the week.';
	const startTime = form.startTime.trim();
	if (!TIME_PATTERN.test(startTime)) errors.startTime = 'Use a time like 15:00.';
	if (form.intervalWeeks !== '1' && form.intervalWeeks !== '2') {
		errors.intervalWeeks = 'Choose weekly or every 2 weeks.';
	}

	const startsOn = form.startsOn.trim();
	if (!isDate(startsOn)) errors.startsOn = 'Choose a start date.';
	else if (startsOn < today) errors.startsOn = 'The start date has already passed.';
	else if (startsOn > addDays(today, HORIZON_DAYS)) {
		errors.startsOn = 'Start within the next 12 weeks.';
	}

	let endsOn: string | null = null;
	let occurrenceCount: number | null = null;
	if (form.endMode === 'date') {
		endsOn = form.endsOn.trim();
		if (!isDate(endsOn)) errors.endsOn = 'Choose an end date.';
		else if (!errors.startsOn && endsOn < startsOn) {
			errors.endsOn = 'The end date must be on or after the start date.';
		} else if (!errors.startsOn && endsOn > addDays(startsOn, 730)) {
			errors.endsOn = 'End within 2 years of the start date.';
		}
	} else if (form.endMode === 'count') {
		const raw = form.occurrenceCount.trim();
		occurrenceCount = /^\d+$/.test(raw) ? Number(raw) : null;
		if (occurrenceCount === null || occurrenceCount < 1 || occurrenceCount > MAX_COUNT) {
			errors.occurrenceCount = `Enter a number of lessons from 1 to ${MAX_COUNT}.`;
		}
	} else if (form.endMode !== 'none') {
		errors.endMode = 'Choose how the lessons end.';
	}

	const note = form.note.trim();
	if (note.length > MAX_NOTE) errors.note = 'Notes must be 1000 characters or fewer.';

	if (Object.keys(errors).length > 0) return { ok: false, errors };
	const input: SeriesInput = {
		studentId: form.studentId,
		lessonTypeId: form.lessonTypeId,
		weekday,
		startTime,
		intervalWeeks: form.intervalWeeks === '2' ? 2 : 1,
		startsOn,
		endsOn,
		occurrenceCount,
		note
	};
	if (endsOn !== null && endsOn < firstDate(input)) {
		return { ok: false, errors: { endsOn: 'No lessons fall between the start and end dates.' } };
	}
	return { ok: true, value: input };
}

// ---- Checking dates ----

export interface AssessedDate extends Occurrence {
	status: DateStatus;
}

/**
 * Admin-created lessons ignore the public booking rules (notice, advance window, weekly hours)
 * but not real clashes: live bookings, closed date overrides and Google Calendar busy time.
 */
export async function assessDates(
	deps: { store: AppStore; calendar?: CalendarClient },
	settings: StudioSettings,
	durationMin: number,
	occurrences: Occurrence[],
	now: Date
): Promise<AssessedDate[]> {
	if (occurrences.length === 0) return [];
	const durationMs = durationMin * MINUTE_MS;
	const bufferMs = settings.bufferMin * MINUTE_MS;
	const first = occurrences[0];
	const last = occurrences[occurrences.length - 1];
	const rangeEnd = new Date(last.startsAt.getTime() + durationMs + bufferMs);
	const [live, overrides, busy] = await Promise.all([
		deps.store.getLiveBookings(
			new Date(first.startsAt.getTime() - DAY_MS),
			new Date(rangeEnd.getTime() + DAY_MS)
		),
		deps.store.getDateOverrides(first.date, last.date),
		calendarBusy(deps.calendar, settings, first.startsAt, rangeEnd)
	]);
	const closed = new Set(overrides.filter((o) => o.isClosed).map((o) => o.date));

	return occurrences.map((o) => {
		const start = o.startsAt.getTime();
		const end = start + durationMs;
		let status: DateStatus = 'ok';
		if (start <= now.getTime()) status = 'past';
		else if (
			live.some((b) => start < b.blockedUntil.getTime() && b.startsAt.getTime() < end + bufferMs)
		) {
			status = 'clash';
		} else if (closed.has(o.date)) status = 'closed';
		else if (
			busy.some((b) => start < b.end.getTime() + bufferMs && b.start.getTime() < end + bufferMs)
		) {
			status = 'busy';
		}
		return { ...o, status };
	});
}

// ---- Preview and create ----

export interface PreviewDate {
	date: string;
	startsAt: Date;
	whenLabel: string;
	status: DateStatus;
	statusLabel: string;
}

export interface SeriesPreview {
	input: SeriesInput;
	scheduleLabel: string;
	studentName: string;
	lessonTypeName: string;
	priceLabel: string;
	dates: PreviewDate[];
	bookable: number;
	/** Last date covered now; later dates are added by the daily top-up. */
	through: string;
	/** True when the series runs past `through`. */
	continues: boolean;
	/** "Until Tuesday, March 3, 2027", "10 lessons" or "No end date". */
	endLabel: string;
}

export type PreviewResult =
	{ ok: true; preview: SeriesPreview } | Extract<Result<never>, { ok: false }>;

function endLabel(rule: RecurrenceRule, timezone: string): string {
	if (rule.occurrenceCount !== null) {
		return rule.occurrenceCount === 1 ? '1 lesson' : `${rule.occurrenceCount} lessons`;
	}
	if (rule.endsOn !== null) {
		return `Until ${DateTime.fromISO(rule.endsOn, { zone: timezone }).setLocale('en-US').toFormat('cccc, LLLL d, yyyy')}`;
	}
	return 'No end date';
}

/** Validates the form for this family and lists every date to be created now, with its status. */
export async function previewSeries(
	deps: { store: AppStore; calendar?: CalendarClient },
	accountId: string,
	form: SeriesForm,
	now: Date
): Promise<PreviewResult> {
	const { store } = deps;
	const settings = await store.getSettings();
	const zone = settings.timezone;
	const valid = validateSeriesForm(form, localToday(now, zone));
	if (!valid.ok) return valid;
	const input = valid.value;

	const account = await store.getAccount(accountId);
	const student =
		account?.role === 'client' ? account.students.find((s) => s.id === input.studentId) : undefined;
	if (!student) return { ok: false, errors: { studentId: 'Student not found.' } };
	const lessonType = (await store.getActiveLessonTypes()).find((t) => t.id === input.lessonTypeId);
	if (!lessonType) return { ok: false, errors: { lessonTypeId: 'Choose an active lesson type.' } };
	const custom = student.prices.find((p) => p.lessonTypeId === lessonType.id);

	const through = materialiseThrough(input, localToday(now, zone));
	const occurrences = occurrenceStarts(input, zone, firstDate(input), through);
	const assessed = await assessDates(deps, settings, lessonType.durationMin, occurrences, now);
	const last = lastDate(input);
	return {
		ok: true,
		preview: {
			input,
			scheduleLabel: seriesLabel(input),
			studentName: student.name,
			lessonTypeName: lessonType.name,
			priceLabel: formatMoney(custom?.priceCents ?? lessonType.priceCents),
			dates: assessed.map((a) => ({
				date: a.date,
				startsAt: a.startsAt,
				whenLabel: formatDateTime(a.startsAt, zone),
				status: a.status,
				statusLabel: DATE_STATUS_LABELS[a.status]
			})),
			bookable: assessed.filter((a) => a.status === 'ok').length,
			through,
			continues: last === null || last > through,
			endLabel: endLabel(input, zone)
		}
	};
}

export type CreateSeriesResult =
	| {
			ok: true;
			seriesId: string;
			booked: string[];
			skipped: { whenLabel: string; reason: string }[];
	  }
	| { ok: false; errors: Record<string, string> };

function emailData(series: LessonSeries, timezone: string): SeriesEmailData {
	return {
		accountName: series.accountName,
		email: series.accountEmail,
		studentName: series.studentName,
		lessonTypeName: series.lessonTypeName,
		durationMin: series.durationMin,
		timezone,
		priceCents: series.priceCents,
		scheduleLabel: seriesLabel(series),
		scheduleText: scheduleDescription(series)
	};
}

/**
 * Re-checks every date at submit, saves the series with the OK dates (the database skips any that
 * clash by now), then sends one email (unless `notify` is off) and adds one Google Calendar event
 * per lesson. Skipped dates
 * are reported; nothing existing is changed.
 */
export async function createSeries(
	deps: SeriesDeps,
	accountId: string,
	form: SeriesForm,
	now: Date
): Promise<CreateSeriesResult> {
	const { store, mailer, appUrl } = deps;
	const checked = await previewSeries(deps, accountId, form, now);
	if (!checked.ok) return checked;
	const { preview } = checked;
	const okDates = preview.dates.filter((d) => d.status === 'ok');
	if (okDates.length === 0) {
		return { ok: false, errors: { form: 'None of these dates can be booked.' } };
	}

	let created;
	try {
		created = await store.createSeries(
			preview.input,
			okDates.map((d) => d.startsAt),
			preview.through,
			now
		);
	} catch (e) {
		if (e instanceof AccountStoreError)
			return { ok: false, errors: { studentId: 'Student not found.' } };
		if (e instanceof BookingStoreError) {
			return { ok: false, errors: { lessonTypeId: 'Choose an active lesson type.' } };
		}
		throw e;
	}
	const { series, occurrences } = created;

	const skipped: SkippedLesson[] = [
		...preview.dates
			.filter((d) => d.status !== 'ok')
			.map((d) => ({ startsAt: d.startsAt, reason: d.statusLabel })),
		...occurrences
			.filter((o) => o.bookingId === null)
			.map((o) => ({ startsAt: o.startsAt, reason: DATE_STATUS_LABELS.clash }))
	].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

	// The series has committed: from here on failures only log.
	const settings = await store.getSettings();
	const bookings = (await store.listSeriesBookings(series.id)).filter(
		(b) => b.status === 'approved'
	);
	if (form.notify === 'on') {
		try {
			await mailer.send(
				seriesCreatedEmail(
					emailData(series, settings.timezone),
					bookings.map((b) => ({
						bookingId: b.id,
						startsAt: b.startsAt,
						manageUrl: `${appUrl}/manage/${b.manageToken}`
					})),
					{
						policyText: settings.cancellationPolicyText,
						continues: preview.continues,
						accountUrl: `${appUrl}/account`,
						now
					}
				)
			);
		} catch (e) {
			console.error('Failed to send series created email', e);
		}
	}
	for (const b of bookings) await addLessonToCalendar(deps, b, settings);

	return {
		ok: true,
		seriesId: series.id,
		booked: bookings.map((b) => formatDateTime(b.startsAt, settings.timezone)),
		skipped: skipped.map((s) => ({
			whenLabel: formatDateTime(s.startsAt, settings.timezone),
			reason: s.reason
		}))
	};
}

// ---- Cancelling ----

/**
 * Ends the series: cancels its live lessons from `from` (default now; past lessons are never
 * touched), stops the daily top-up, sends one email (unless `notify` is false) and removes each
 * lesson's calendar event.
 */
export async function endSeries(
	deps: SeriesDeps,
	seriesId: string,
	from: Date | null,
	now: Date,
	notify = true
): Promise<ActionResult & { cancelled?: number }> {
	const { store, mailer } = deps;
	if (from && Number.isNaN(from.getTime())) return { ok: false, message: 'Choose a lesson.' };
	let cancelled: AdminBooking[];
	try {
		cancelled = await store.endSeries(seriesId, from ?? now, now);
	} catch (e) {
		if (e instanceof SeriesStoreError) return { ok: false, message: 'Series not found.' };
		throw e;
	}
	const settings = await store.getSettings();
	if (notify && cancelled.length > 0) {
		try {
			const series = await store.getSeries(seriesId);
			if (series) {
				await mailer.send(
					seriesEndedEmail(
						emailData(series, settings.timezone),
						cancelled.map((b) => b.startsAt)
					)
				);
			}
		} catch (e) {
			console.error('Failed to send series ended email', e);
		}
	}
	for (const b of cancelled) await removeLessonFromCalendar(deps, b, settings);
	return { ok: true, cancelled: cancelled.length };
}

const MAX_CANCEL_REASON = 500;

/**
 * The admin cancels one lesson, from any admin page. Never a late cancellation; the family is
 * emailed (with `reason` when given) unless `notify` is false, and the calendar event is removed.
 */
export async function adminCancelLesson(
	deps: SeriesDeps,
	bookingId: string,
	now: Date,
	reason = '',
	notify = true
): Promise<ActionResult> {
	const { store, mailer, appUrl } = deps;
	const trimmed = reason.trim();
	if (trimmed.length > MAX_CANCEL_REASON) {
		return { ok: false, message: 'Reason must be 500 characters or fewer.' };
	}
	const existing = await store.getBooking(bookingId);
	if (!existing) return { ok: false, message: 'Lesson not found.' };
	let booking: AdminBooking;
	try {
		booking = await store.cancelBooking(
			{ kind: 'token', manageToken: existing.manageToken },
			false,
			now
		);
	} catch (e) {
		if (e instanceof AccountStoreError) {
			return { ok: false, message: 'This lesson can no longer be cancelled.' };
		}
		throw e;
	}
	// The cancellation has committed: from here on a failure must only log.
	let settings: StudioSettings;
	try {
		settings = await store.getSettings();
	} catch (e) {
		console.error('Failed to read settings after cancelling a lesson', e);
		return { ok: true };
	}
	if (notify) await sendTeacherCancelEmail(mailer, booking, settings, appUrl, trimmed);
	await removeLessonFromCalendar(deps, existing, settings);
	return { ok: true };
}

async function sendTeacherCancelEmail(
	mailer: Mailer,
	booking: AdminBooking,
	settings: StudioSettings,
	appUrl: string,
	reason: string
): Promise<void> {
	try {
		await mailer.send(
			lessonCancelledByTeacherEmail(
				{
					accountName: booking.accountName,
					email: booking.accountEmail,
					studentName: booking.studentName,
					lessonTypeName: booking.lessonTypeName,
					durationMin: booking.durationMin,
					startsAt: booking.startsAt,
					timezone: settings.timezone,
					priceCents: booking.priceCents,
					note: booking.note,
					manageUrl: `${appUrl}/manage/${booking.manageToken}`
				},
				reason || null
			)
		);
	} catch (e) {
		console.error('Failed to send cancellation email', e);
	}
}

// ---- Daily top-up ----

export interface TopUpResult {
	/** Series that got new dates considered. */
	series: number;
	lessonsAdded: number;
	/** Series left for the next run because the subrequest budget ran out. */
	deferred: number;
	/** Worst-case subrequests spent on series (not counting the fixed reads up front). */
	subrequests: number;
}

/** Per series: live bookings, date overrides, Google busy, add occurrences, list bookings. */
const TOP_UP_SERIES_SUBREQUESTS = 5;
/** Per new lesson: create the Google event, save its id. */
const TOP_UP_LESSON_SUBREQUESTS = 2;

/**
 * Creates occurrences up to 12 weeks ahead for open-ended and long series, skipping dates that
 * clash, as at creation. Sends no email; adds a calendar event per new lesson.
 *
 * Stops before a series whose worst-case cost would take it past `budget` subrequests, so one run
 * stays under the Workers limit; the rest are still due and the next (hourly) run picks them up.
 * The first series always runs, so a run always makes progress.
 */
export async function topUpSeries(
	deps: { store: AppStore; calendar?: CalendarClient; appUrl: string },
	now: Date,
	budget = Infinity
): Promise<TopUpResult> {
	const { store } = deps;
	const settings = await store.getSettings();
	const zone = settings.timezone;
	const today = localToday(now, zone);
	const horizon = addDays(today, HORIZON_DAYS);
	const lessonTypes = await store.listAllLessonTypes();
	const result: TopUpResult = { series: 0, lessonsAdded: 0, deferred: 0, subrequests: 0 };

	const due = await store.listSeriesNeedingTopUp(horizon);
	for (const [i, series] of due.entries()) {
		try {
			const through = materialiseThrough(series, today);
			const next = series.materializedThrough
				? nextDate(series.materializedThrough)
				: firstDate(series);
			const from = next > today ? next : today;
			if (from > through) continue;

			const durationMin =
				lessonTypes.find((t) => t.id === series.lessonTypeId)?.durationMin ?? series.durationMin;
			const occurrences = occurrenceStarts(series, zone, from, through);
			const cost = TOP_UP_SERIES_SUBREQUESTS + TOP_UP_LESSON_SUBREQUESTS * occurrences.length;
			if (result.subrequests > 0 && result.subrequests + cost > budget) {
				result.deferred = due.length - i;
				break;
			}
			result.subrequests += cost;
			const assessed = await assessDates(deps, settings, durationMin, occurrences, now);
			const added = await store.addSeriesOccurrences(
				series.id,
				assessed.filter((a) => a.status === 'ok').map((a) => a.startsAt),
				through,
				now
			);
			result.series++;

			const ids = new Set(added.map((a) => a.bookingId).filter((id) => id !== null));
			result.lessonsAdded += ids.size;
			if (ids.size === 0) continue;
			const bookings = await store.listSeriesBookings(series.id);
			for (const b of bookings.filter((b) => ids.has(b.id))) {
				await addLessonToCalendar(deps, b, settings);
			}
		} catch (e) {
			if (e instanceof SeriesStoreError && e.code === 'ended') continue;
			console.error(`Failed to top up series ${series.id}`, e);
		}
	}
	return result;
}

// ---- Views ----

export interface SeriesView {
	id: string;
	scheduleLabel: string;
	studentId: string;
	studentName: string;
	accountId: string;
	accountName: string;
	lessonTypeName: string;
	durationMin: number;
	priceLabel: string;
	note: string;
	startsOnLabel: string;
	endLabel: string;
	ended: boolean;
	endedLabel: string | null;
	upcomingCount: number;
}

export interface SeriesLessonView {
	id: string;
	whenLabel: string;
	startsAtIso: string;
	status: BookingStatus;
	statusLabel: string;
	lateCancel: boolean;
	canCancel: boolean;
}

const LESSON_STATUS_LABELS: Record<BookingStatus, string> = {
	pending: 'Pending',
	approved: 'Booked',
	declined: 'Declined',
	cancelled: 'Cancelled',
	expired: 'Expired'
};

const isUpcoming = (b: AdminBooking, now: Date) =>
	(b.status === 'approved' || b.status === 'pending') && b.startsAt > now;

function toSeriesView(
	series: LessonSeries,
	bookings: AdminBooking[],
	timezone: string,
	now: Date
): SeriesView {
	const date = (d: string) =>
		DateTime.fromISO(d, { zone: timezone }).setLocale('en-US').toFormat('cccc, LLLL d, yyyy');
	return {
		id: series.id,
		scheduleLabel: seriesLabel(series),
		studentId: series.studentId,
		studentName: series.studentName,
		accountId: series.accountId,
		accountName: series.accountName,
		lessonTypeName: series.lessonTypeName,
		durationMin: series.durationMin,
		priceLabel: formatMoney(series.priceCents),
		note: series.note,
		startsOnLabel: date(firstDate(series)),
		endLabel: endLabel(series, timezone),
		ended: series.endedAt !== null,
		endedLabel: series.endedAt ? formatDateTime(series.endedAt, timezone) : null,
		upcomingCount: bookings.filter((b) => isUpcoming(b, now)).length
	};
}

export async function listFamilySeries(
	store: AppStore,
	accountId: string,
	now: Date
): Promise<SeriesView[]> {
	const [{ timezone }, all] = await Promise.all([
		store.getSettings(),
		store.listSeriesForAccount(accountId)
	]);
	return Promise.all(
		all.map(async (s) => toSeriesView(s, await store.listSeriesBookings(s.id), timezone, now))
	);
}

export async function getSeriesPage(
	store: AppStore,
	seriesId: string,
	now: Date
): Promise<{ series: SeriesView; lessons: SeriesLessonView[] } | null> {
	const series = await store.getSeries(seriesId);
	if (!series) return null;
	const [{ timezone }, bookings] = await Promise.all([
		store.getSettings(),
		store.listSeriesBookings(seriesId)
	]);
	return {
		series: toSeriesView(series, bookings, timezone, now),
		lessons: bookings.map((b) => ({
			id: b.id,
			whenLabel: formatDateTime(b.startsAt, timezone),
			startsAtIso: b.startsAt.toISOString(),
			status: b.status,
			statusLabel: LESSON_STATUS_LABELS[b.status],
			lateCancel: b.lateCancel,
			canCancel: isUpcoming(b, now)
		}))
	};
}
