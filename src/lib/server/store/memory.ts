import type { DateOverride, WeeklyHours } from '../availability';
import { demoData, type DemoData } from './demo-data';
import {
	AdminStoreError,
	BookingStoreError,
	type Account,
	type AdminBooking,
	type AdminLessonType,
	type AdminStore,
	type BookingFilter,
	type BookingStatus,
	type BookingStore,
	type BookingSummary,
	type CreatedBooking,
	type DateOverrideWithNote,
	type GuestBookingInput,
	type LessonType,
	type LessonTypeInput,
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
	paidAt: Date | null;
	declineReason: string | null;
	decidedAt: Date | null;
	lateCancel: boolean;
}

interface StoredLoginToken {
	accountId: string;
	expiresAt: Date;
	used: boolean;
}

const isLive = (b: StoredBooking) => b.status === 'pending' || b.status === 'approved';

/** In-memory BookingStore that mirrors the request_guest_booking SQL function's semantics. */
export class MemoryBookingStore implements BookingStore, AdminStore {
	private readonly data: DemoData;
	private readonly bookings: StoredBooking[] = [];
	private readonly loginTokens = new Map<string, StoredLoginToken>();
	private readonly overrideNotes = new Map<string, string>();

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
		return this.data.lessonTypes
			.filter((t) => t.active)
			.map(({ active: _active, ...t }) => t)
			.sort((a, b) => a.sortOrder - b.sortOrder);
	}

	async getLiveBookings(from: Date, to: Date): Promise<LiveBooking[]> {
		return this.bookings
			.filter((b) => isLive(b) && b.startsAt < to && b.blockedUntil > from)
			.map(({ startsAt, endsAt, blockedUntil }) => ({ startsAt, endsAt, blockedUntil }));
	}

	async requestGuestBooking(input: GuestBookingInput, now: Date): Promise<CreatedBooking> {
		const lessonType = this.data.lessonTypes.find((t) => t.id === input.lessonTypeId);
		if (!lessonType || !lessonType.active) throw new BookingStoreError('lesson_type_not_found');

		// Checks run against lookups only; rows are created after every check passes so a
		// rejected request mutates nothing (the SQL function is one transaction).
		const email = input.email.trim().toLowerCase();
		const existingAccount = this.data.accounts.find((a) => a.email.toLowerCase() === email);

		if (existingAccount) {
			const ownStudentIds = new Set(
				this.data.students.filter((s) => s.accountId === existingAccount.id).map((s) => s.id)
			);
			const pending = this.bookings.filter(
				(b) => b.status === 'pending' && ownStudentIds.has(b.studentId) && b.startsAt > now
			).length;
			if (pending >= MAX_PENDING) throw new BookingStoreError('too_many_pending');
		}

		const endsAt = new Date(input.startsAt.getTime() + lessonType.durationMin * MINUTE_MS);
		const blockedUntil = new Date(endsAt.getTime() + this.data.settings.bufferMin * MINUTE_MS);
		const clash = this.bookings.some(
			(b) => isLive(b) && input.startsAt < b.blockedUntil && b.startsAt < blockedUntil
		);
		if (clash) throw new BookingStoreError('slot_taken');

		// Existing accounts keep their name; only new ones take the submitted name.
		let account = existingAccount;
		if (!account) {
			account = { id: crypto.randomUUID(), name: input.accountName, email, role: 'client' };
			this.data.accounts.push(account);
		}
		const accountId = account.id;

		const wanted = input.studentName.trim().toLowerCase();
		let student = this.data.students.find(
			(s) => s.accountId === accountId && s.name.trim().toLowerCase() === wanted
		);
		if (!student) {
			student = { id: crypto.randomUUID(), accountId, name: input.studentName.trim() };
			this.data.students.push(student);
		}

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
			note: input.note ?? '',
			paidAt: null,
			declineReason: null,
			decidedAt: null,
			lateCancel: false
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
			priceCents: booking.priceCents,
			note: booking.note
		};
	}

	// ---- AdminStore ----

	async findAccountByEmail(email: string): Promise<Account | null> {
		const wanted = email.trim().toLowerCase();
		const account = this.data.accounts.find((a) => a.email.toLowerCase() === wanted);
		return account ? { ...account } : null;
	}

	async findAccountById(id: string): Promise<Account | null> {
		const account = this.data.accounts.find((a) => a.id === id);
		return account ? { ...account } : null;
	}

	async createLoginToken(accountId: string, tokenHash: string, expiresAt: Date): Promise<void> {
		this.loginTokens.set(tokenHash, { accountId, expiresAt, used: false });
	}

	async consumeLoginToken(tokenHash: string, now: Date): Promise<string | null> {
		const token = this.loginTokens.get(tokenHash);
		if (!token || token.used || token.expiresAt <= now) return null;
		token.used = true;
		return token.accountId;
	}

	async listBookings(filter: BookingFilter): Promise<AdminBooking[]> {
		const sign = filter.order === 'asc' ? 1 : -1;
		return this.bookings
			.filter(
				(b) =>
					filter.statuses.includes(b.status) &&
					(!filter.from || b.startsAt >= filter.from) &&
					(!filter.to || b.startsAt < filter.to) &&
					(!filter.unpaidOnly || b.paidAt === null)
			)
			.sort((a, b) => sign * (a.startsAt.getTime() - b.startsAt.getTime()))
			.map((b) => this.toAdminBooking(b));
	}

	async getBooking(id: string): Promise<AdminBooking | null> {
		const booking = this.bookings.find((b) => b.id === id);
		return booking ? this.toAdminBooking(booking) : null;
	}

	async decideBooking(
		id: string,
		decision: 'approved' | 'declined',
		reason: string | null,
		now: Date
	): Promise<AdminBooking> {
		const booking = this.requireBooking(id);
		if (booking.status !== 'pending') throw new AdminStoreError('not_pending');
		if (decision === 'approved' && booking.startsAt <= now) throw new AdminStoreError('in_past');
		booking.status = decision;
		booking.decidedAt = now;
		booking.declineReason = decision === 'declined' ? reason : null;
		return this.toAdminBooking(booking);
	}

	async setPaid(id: string, paidAt: Date | null): Promise<AdminBooking> {
		const booking = this.requireBooking(id);
		booking.paidAt = paidAt;
		return this.toAdminBooking(booking);
	}

	async updateSettings(settings: StudioSettings): Promise<void> {
		this.data.settings = { ...settings };
	}

	async replaceWeeklyHours(hours: WeeklyHours[]): Promise<void> {
		this.data.weeklyHours = hours.map((h) => ({ ...h }));
	}

	async listDateOverrides(fromDate: string): Promise<DateOverrideWithNote[]> {
		return this.data.dateOverrides
			.filter((o) => o.date >= fromDate)
			.sort((a, b) => a.date.localeCompare(b.date))
			.map((o) => ({ ...structuredClone(o), note: this.overrideNotes.get(o.date) ?? '' }));
	}

	async saveDateOverride(override: DateOverrideWithNote): Promise<void> {
		const { note, ...rest } = override;
		this.data.dateOverrides = this.data.dateOverrides.filter((o) => o.date !== override.date);
		this.data.dateOverrides.push(structuredClone(rest));
		this.overrideNotes.set(override.date, note);
	}

	async deleteDateOverride(date: string): Promise<void> {
		this.data.dateOverrides = this.data.dateOverrides.filter((o) => o.date !== date);
		this.overrideNotes.delete(date);
	}

	async listAllLessonTypes(): Promise<AdminLessonType[]> {
		return this.data.lessonTypes
			.map((t) => ({ ...t }))
			.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
	}

	async createLessonType(input: LessonTypeInput): Promise<AdminLessonType> {
		const created: AdminLessonType = { id: crypto.randomUUID(), ...input };
		this.data.lessonTypes.push(created);
		return { ...created };
	}

	async updateLessonType(id: string, input: LessonTypeInput): Promise<AdminLessonType> {
		const existing = this.data.lessonTypes.find((t) => t.id === id);
		if (!existing) throw new AdminStoreError('not_found');
		Object.assign(existing, input);
		return { ...existing };
	}

	private requireBooking(id: string): StoredBooking {
		const booking = this.bookings.find((b) => b.id === id);
		if (!booking) throw new AdminStoreError('not_found');
		return booking;
	}

	private toAdminBooking(booking: StoredBooking): AdminBooking {
		const student = this.data.students.find((s) => s.id === booking.studentId)!;
		const account = this.data.accounts.find((a) => a.id === student.accountId)!;
		const lessonType = this.data.lessonTypes.find((t) => t.id === booking.lessonTypeId)!;
		return {
			id: booking.id,
			status: booking.status,
			startsAt: booking.startsAt,
			endsAt: booking.endsAt,
			lessonTypeName: lessonType.name,
			// The booked length, not the lesson type's current one, which the admin may since have changed.
			durationMin: Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / MINUTE_MS),
			studentName: student.name,
			accountName: account.name,
			accountEmail: account.email,
			priceCents: booking.priceCents,
			paidAt: booking.paidAt,
			note: booking.note,
			declineReason: booking.declineReason,
			lateCancel: booking.lateCancel,
			manageToken: booking.manageToken
		};
	}
}
