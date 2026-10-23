import type { DateOverride, WeeklyHours } from '../availability';
import { demoData, type DemoData } from './demo-data';
import {
	BookingStoreError,
	type BookingStatus,
	type BookingStore,
	type BookingSummary,
	type CreatedBooking,
	type GuestBookingInput,
	type LessonType,
	type LiveBooking,
	type StudioSettings
} from './types';

const MAX_PENDING = 2;
const MINUTE_MS = 60_000;

interface StoredBooking {
	id: string;
	manageToken: string;
	studentId: string;
	lessonTypeId: string;
	startsAt: Date;
	endsAt: Date;
	blockedUntil: Date;
	status: BookingStatus;
	priceCents: number;
	note: string;
}

const isLive = (b: StoredBooking) => b.status === 'pending' || b.status === 'approved';

/** In-memory BookingStore that mirrors the request_guest_booking SQL function's semantics. */
export class MemoryBookingStore implements BookingStore {
	private readonly data: DemoData;
	private readonly bookings: StoredBooking[] = [];

	constructor(data: DemoData = demoData()) {
		this.data = structuredClone(data);
	}

	async getSettings(): Promise<StudioSettings> {
		return { ...this.data.settings };
	}

	async getWeeklyHours(): Promise<WeeklyHours[]> {
		return this.data.weeklyHours.map((h) => ({ ...h }));
	}

	async getDateOverrides(fromDate: string, toDate: string): Promise<DateOverride[]> {
		return this.data.dateOverrides
			.filter((o) => o.date >= fromDate && o.date <= toDate)
			.sort((a, b) => a.date.localeCompare(b.date))
			.map((o) => structuredClone(o));
	}

	async getActiveLessonTypes(): Promise<LessonType[]> {
		return this.data.lessonTypes.map((t) => ({ ...t })).sort((a, b) => a.sortOrder - b.sortOrder);
	}

	async getLiveBookings(from: Date, to: Date): Promise<LiveBooking[]> {
		return this.bookings
			.filter((b) => isLive(b) && b.startsAt < to && b.blockedUntil > from)
			.map(({ startsAt, endsAt, blockedUntil }) => ({ startsAt, endsAt, blockedUntil }));
	}

	async requestGuestBooking(input: GuestBookingInput, now: Date): Promise<CreatedBooking> {
		const lessonType = this.data.lessonTypes.find((t) => t.id === input.lessonTypeId);
		if (!lessonType) throw new BookingStoreError('lesson_type_not_found');

		const email = input.email.trim().toLowerCase();
		let account = this.data.accounts.find((a) => a.email.toLowerCase() === email);
		if (!account) {
			// Existing accounts keep their name; only new ones take the submitted name.
			account = { id: crypto.randomUUID(), name: input.accountName, email, role: 'client' };
			this.data.accounts.push(account);
		}
		const accountId = account.id;

		const ownStudentIds = new Set(
			this.data.students.filter((s) => s.accountId === accountId).map((s) => s.id)
		);
		const pending = this.bookings.filter(
			(b) => b.status === 'pending' && ownStudentIds.has(b.studentId) && b.startsAt > now
		).length;
		if (pending >= MAX_PENDING) throw new BookingStoreError('too_many_pending');

		const wanted = input.studentName.trim().toLowerCase();
		let student = this.data.students.find(
			(s) => s.accountId === accountId && s.name.trim().toLowerCase() === wanted
		);
		if (!student) {
			student = { id: crypto.randomUUID(), accountId, name: input.studentName.trim() };
			this.data.students.push(student);
		}

		const endsAt = new Date(input.startsAt.getTime() + lessonType.durationMin * MINUTE_MS);
		const blockedUntil = new Date(endsAt.getTime() + this.data.settings.bufferMin * MINUTE_MS);
		const clash = this.bookings.some(
			(b) => isLive(b) && input.startsAt < b.blockedUntil && b.startsAt < blockedUntil
		);
		if (clash) throw new BookingStoreError('slot_taken');

		const booking: StoredBooking = {
			id: crypto.randomUUID(),
			manageToken: crypto.randomUUID().replaceAll('-', ''),
			studentId: student.id,
			lessonTypeId: lessonType.id,
			startsAt: input.startsAt,
			endsAt,
			blockedUntil,
			status: 'pending',
			priceCents: lessonType.priceCents,
			note: input.note ?? ''
		};
		this.bookings.push(booking);
		return {
			bookingId: booking.id,
			manageToken: booking.manageToken,
			priceCents: booking.priceCents,
			startsAt: booking.startsAt,
			endsAt: booking.endsAt
		};
	}

	async getBookingByManageToken(token: string): Promise<BookingSummary | null> {
		const booking = this.bookings.find((b) => b.manageToken === token);
		if (!booking) return null;
		const student = this.data.students.find((s) => s.id === booking.studentId)!;
		const account = this.data.accounts.find((a) => a.id === student.accountId)!;
		const lessonType = this.data.lessonTypes.find((t) => t.id === booking.lessonTypeId)!;
		return {
			status: booking.status,
			startsAt: booking.startsAt,
			endsAt: booking.endsAt,
			lessonTypeName: lessonType.name,
			studentName: student.name,
			accountName: account.name,
			priceCents: booking.priceCents,
			note: booking.note
		};
	}
}
