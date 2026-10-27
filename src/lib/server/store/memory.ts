import type { DateOverride, WeeklyHours } from '../availability';
import { demoData, type DemoData } from './demo-data';
import {
	AccountStoreError,
	AdminStoreError,
	BookingStoreError,
	type Account,
	type AccountBookingInput,
	type AccountStore,
	type AccountWithStudents,
	type AdminBooking,
	type CancelTarget,
	type Student,
	type StudentPrice,
	type AdminLessonType,
	type AdminStore,
	type BookingFilter,
	type DateRange,
	type BookingStatus,
	type BookingStore,
	type BookingSummary,
	type CreatedBooking,
	type DateOverrideWithNote,
	type GuestBookingInput,
	type LessonType,
	type LessonTypeInput,
	type LiveBooking,
	type LessonSeries,
	type OccurrenceResult,
	type PasswordTokenData,
	type SeriesInput,
	type SeriesStore,
	type SeriesTag,
	SeriesStoreError,
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
	gcalEventId: string | null;
	seriesId: string | null;
}

interface StoredSeries extends SeriesInput {
	id: string;
	priceCents: number;
	materializedThrough: string | null;
	createdAt: Date;
	endedAt: Date | null;
}

interface StoredLoginToken {
	accountId: string;
	expiresAt: Date;
	used: boolean;
}

interface StoredPasswordToken {
	data: PasswordTokenData;
	expiresAt: Date;
	used: boolean;
}

const isLive = (b: StoredBooking) => b.status === 'pending' || b.status === 'approved';

/** In-memory BookingStore that mirrors the request_guest_booking SQL function's semantics. */
export class MemoryBookingStore implements BookingStore, AdminStore, AccountStore, SeriesStore {
	private readonly data: DemoData;
	private readonly bookings: StoredBooking[] = [];
	private readonly series: StoredSeries[];
	private readonly loginTokens = new Map<string, StoredLoginToken>();
	// Kept apart from the account rows so a hash never leaks into a returned Account.
	private readonly passwordHashes = new Map<string, string>();
	private readonly passwordTokens = new Map<string, StoredPasswordToken>();
	private readonly passwordFailures: { email: string; failedAt: Date }[] = [];
	private readonly overrideNotes = new Map<string, string>();
	private readonly accountNotes = new Map<string, string>();
	private readonly studentNotes = new Map<string, string>();

	constructor(data: DemoData = demoData()) {
		this.data = structuredClone(data);
		this.series = this.data.lessonSeries.map((x) => ({
			...x,
			materializedThrough: null,
			createdAt: new Date(0),
			endedAt: null
		}));
		for (const p of this.data.passwords) this.passwordHashes.set(p.accountId, p.passwordHash);
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

		const { endsAt, blockedUntil } = this.requireFreeSlot(input.startsAt, lessonType.durationMin);

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
			lateCancel: false,
			gcalEventId: null,
			seriesId: null
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

	async getPasswordHash(accountId: string): Promise<string | null> {
		return this.passwordHashes.get(accountId) ?? null;
	}

	async setPasswordHash(accountId: string, passwordHash: string): Promise<void> {
		if (!this.data.accounts.some((a) => a.id === accountId)) throw new AdminStoreError('not_found');
		this.passwordHashes.set(accountId, passwordHash);
	}

	async createPasswordToken(
		tokenHash: string,
		data: PasswordTokenData,
		expiresAt: Date
	): Promise<void> {
		const stored =
			data.purpose === 'register'
				? { ...data, email: data.email.trim().toLowerCase() }
				: { ...data };
		this.passwordTokens.set(tokenHash, { data: stored, expiresAt, used: false });
	}

	private usePasswordToken(
		tokenHash: string,
		purpose: PasswordTokenData['purpose'],
		now: Date
	): PasswordTokenData | null {
		const token = this.passwordTokens.get(tokenHash);
		if (!token || token.used || token.expiresAt <= now || token.data.purpose !== purpose) {
			return null;
		}
		token.used = true;
		return token.data;
	}

	/** Mirrors password_link_used: void the account's other unused tokens, clear its lockout. */
	private passwordLinkUsed(accountId: string, email: string): void {
		for (const token of this.passwordTokens.values()) {
			const d = token.data;
			if (
				(d.purpose === 'reset' && d.accountId === accountId) ||
				(d.purpose === 'register' && d.email === email)
			) {
				token.used = true;
			}
		}
		this.removePasswordFailures(email);
	}

	private removePasswordFailures(email: string): void {
		for (let i = this.passwordFailures.length - 1; i >= 0; i--) {
			if (this.passwordFailures[i].email === email) this.passwordFailures.splice(i, 1);
		}
	}

	async completeRegistration(tokenHash: string, now: Date): Promise<string | null> {
		const data = this.usePasswordToken(tokenHash, 'register', now);
		if (data?.purpose !== 'register') return null;
		let account = this.data.accounts.find((a) => a.email.toLowerCase() === data.email);
		if (!account) {
			account = { id: crypto.randomUUID(), name: data.name, email: data.email, role: 'client' };
			this.data.accounts.push(account);
		}
		this.passwordHashes.set(account.id, data.passwordHash);
		this.passwordLinkUsed(account.id, data.email);
		return account.id;
	}

	async completePasswordReset(
		tokenHash: string,
		passwordHash: string,
		now: Date
	): Promise<string | null> {
		const data = this.usePasswordToken(tokenHash, 'reset', now);
		if (data?.purpose !== 'reset') return null;
		const account = this.data.accounts.find((a) => a.id === data.accountId);
		if (!account) return null;
		this.passwordHashes.set(account.id, passwordHash);
		this.passwordLinkUsed(account.id, account.email.toLowerCase());
		return account.id;
	}

	async countPasswordFailures(email: string, since: Date): Promise<number> {
		const wanted = email.trim().toLowerCase();
		return this.passwordFailures.filter((f) => f.email === wanted && f.failedAt > since).length;
	}

	async recordPasswordFailure(email: string, failedAt: Date): Promise<void> {
		this.passwordFailures.push({ email: email.trim().toLowerCase(), failedAt });
	}

	async clearPasswordFailures(email: string): Promise<void> {
		this.removePasswordFailures(email.trim().toLowerCase());
	}

	async listBookings(filter: BookingFilter): Promise<AdminBooking[]> {
		const sign = filter.order === 'asc' ? 1 : -1;
		return this.bookings
			.filter(
				(b) =>
					filter.statuses.includes(b.status) &&
					(!filter.from || b.startsAt >= filter.from) &&
					(!filter.to || b.startsAt < filter.to) &&
					(!filter.unpaidOnly || b.paidAt === null) &&
					(!filter.lateCancelOnly || b.lateCancel)
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
		this.data.settings = { ...settings, gcalBusyCalendarIds: [...settings.gcalBusyCalendarIds] };
	}

	async setCalendarEventId(bookingId: string, eventId: string | null): Promise<void> {
		this.requireBooking(bookingId).gcalEventId = eventId;
	}

	async expirePendingBookings(now: Date): Promise<number> {
		let count = 0;
		for (const booking of this.bookings) {
			if (booking.status === 'pending' && booking.startsAt <= now) {
				booking.status = 'expired';
				count++;
			}
		}
		return count;
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

	// ---- AccountStore ----

	async listStudents(accountId: string): Promise<Student[]> {
		return this.data.students
			.filter((s) => s.accountId === accountId)
			.map((s) => this.toStudent(s))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	async addStudent(accountId: string, name: string): Promise<Student> {
		const trimmed = name.trim();
		this.requireUniqueStudentName(accountId, trimmed);
		const student = { id: crypto.randomUUID(), accountId, name: trimmed };
		this.data.students.push(student);
		return this.toStudent(student);
	}

	async renameStudent(accountId: string, studentId: string, name: string): Promise<Student> {
		const student = this.data.students.find((s) => s.id === studentId && s.accountId === accountId);
		if (!student) throw new AccountStoreError('not_found');
		const trimmed = name.trim();
		this.requireUniqueStudentName(accountId, trimmed, student.id);
		student.name = trimmed;
		return this.toStudent(student);
	}

	async listStudentPrices(studentIds: string[]): Promise<StudentPrice[]> {
		return this.data.studentPrices
			.filter((p) => studentIds.includes(p.studentId))
			.map((p) => ({ ...p }));
	}

	async listAccountBookings(accountId: string, range: DateRange = {}): Promise<AdminBooking[]> {
		const own = new Set(
			this.data.students.filter((s) => s.accountId === accountId).map((s) => s.id)
		);
		return this.bookings
			.filter(
				(b) =>
					own.has(b.studentId) &&
					(!range.from || b.startsAt >= range.from) &&
					(!range.to || b.startsAt < range.to)
			)
			.sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
			.map((b) => this.toAdminBooking(b));
	}

	async requestAccountBooking(input: AccountBookingInput, now: Date): Promise<CreatedBooking> {
		// Same check order as the request_account_booking SQL function.
		const student = this.data.students.find(
			(s) => s.id === input.studentId && s.accountId === input.accountId
		);
		if (!student) throw new AccountStoreError('not_found');

		const lessonType = this.data.lessonTypes.find((t) => t.id === input.lessonTypeId);
		if (!lessonType || !lessonType.active) throw new BookingStoreError('lesson_type_not_found');

		const ownStudentIds = new Set(
			this.data.students.filter((s) => s.accountId === input.accountId).map((s) => s.id)
		);
		const pending = this.bookings.filter(
			(b) => b.status === 'pending' && ownStudentIds.has(b.studentId) && b.startsAt > now
		).length;
		if (pending >= MAX_PENDING) throw new BookingStoreError('too_many_pending');

		const { endsAt, blockedUntil } = this.requireFreeSlot(input.startsAt, lessonType.durationMin);
		const custom = this.data.studentPrices.find(
			(p) => p.studentId === student.id && p.lessonTypeId === lessonType.id
		);

		const booking: StoredBooking = {
			id: crypto.randomUUID(),
			manageToken: crypto.randomUUID().replaceAll('-', ''),
			studentId: student.id,
			lessonTypeId: lessonType.id,
			startsAt: input.startsAt,
			endsAt,
			blockedUntil,
			status: 'pending',
			priceCents: custom?.priceCents ?? lessonType.priceCents,
			note: input.note ?? '',
			paidAt: null,
			declineReason: null,
			decidedAt: null,
			lateCancel: false,
			gcalEventId: null,
			seriesId: null
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

	async getBookingByTarget(target: CancelTarget): Promise<AdminBooking | null> {
		const booking = this.findByTarget(target);
		return booking ? this.toAdminBooking(booking) : null;
	}

	async cancelBooking(target: CancelTarget, lateCancel: boolean, now: Date): Promise<AdminBooking> {
		const booking = this.findByTarget(target);
		if (!booking) throw new AccountStoreError('not_found');
		if (!isLive(booking) || booking.startsAt <= now) throw new AccountStoreError('not_cancellable');
		booking.status = 'cancelled';
		booking.lateCancel = lateCancel;
		return this.toAdminBooking(booking);
	}

	async listAccounts(): Promise<AccountWithStudents[]> {
		return this.data.accounts
			.map((a) => this.toAccountWithStudents(a))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	async getAccount(accountId: string): Promise<AccountWithStudents | null> {
		const account = this.data.accounts.find((a) => a.id === accountId);
		return account ? this.toAccountWithStudents(account) : null;
	}

	async setStudentPrice(
		studentId: string,
		lessonTypeId: string,
		priceCents: number | null
	): Promise<void> {
		if (!this.data.students.some((s) => s.id === studentId)) {
			throw new AccountStoreError('not_found');
		}
		if (!this.data.lessonTypes.some((t) => t.id === lessonTypeId)) {
			throw new AccountStoreError('not_found');
		}
		this.data.studentPrices = this.data.studentPrices.filter(
			(p) => !(p.studentId === studentId && p.lessonTypeId === lessonTypeId)
		);
		if (priceCents !== null) this.data.studentPrices.push({ studentId, lessonTypeId, priceCents });
	}

	async updateAccountNotes(accountId: string, notes: string): Promise<void> {
		if (!this.data.accounts.some((a) => a.id === accountId)) {
			throw new AccountStoreError('not_found');
		}
		this.accountNotes.set(accountId, notes);
	}

	async updateStudentNotes(studentId: string, notes: string): Promise<void> {
		if (!this.data.students.some((s) => s.id === studentId)) {
			throw new AccountStoreError('not_found');
		}
		this.studentNotes.set(studentId, notes);
	}

	// ---- SeriesStore ----

	async createSeries(
		input: SeriesInput,
		startsAt: Date[],
		through: string,
		now: Date
	): Promise<{ series: LessonSeries; occurrences: OccurrenceResult[] }> {
		// Same check order as the create_lesson_series SQL function.
		if (!this.data.students.some((s) => s.id === input.studentId)) {
			throw new AccountStoreError('not_found');
		}
		const lessonType = this.data.lessonTypes.find((t) => t.id === input.lessonTypeId);
		if (!lessonType || !lessonType.active) throw new BookingStoreError('lesson_type_not_found');
		const custom = this.data.studentPrices.find(
			(p) => p.studentId === input.studentId && p.lessonTypeId === input.lessonTypeId
		);
		const stored: StoredSeries = {
			...input,
			note: input.note ?? '',
			id: crypto.randomUUID(),
			priceCents: custom?.priceCents ?? lessonType.priceCents,
			materializedThrough: null,
			createdAt: now,
			endedAt: null
		};
		this.series.push(stored);
		const occurrences = this.materialise(stored, startsAt, through, now);
		return { series: this.toLessonSeries(stored), occurrences };
	}

	async addSeriesOccurrences(
		seriesId: string,
		startsAt: Date[],
		through: string,
		now: Date
	): Promise<OccurrenceResult[]> {
		const stored = this.series.find((x) => x.id === seriesId);
		if (!stored) throw new SeriesStoreError('not_found');
		if (stored.endedAt) throw new SeriesStoreError('ended');
		return this.materialise(stored, startsAt, through, now);
	}

	async getSeries(id: string): Promise<LessonSeries | null> {
		const stored = this.series.find((x) => x.id === id);
		return stored ? this.toLessonSeries(stored) : null;
	}

	async listSeriesForAccount(accountId: string): Promise<LessonSeries[]> {
		const own = new Set(
			this.data.students.filter((s) => s.accountId === accountId).map((s) => s.id)
		);
		return this.series
			.filter((x) => own.has(x.studentId))
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
			.map((x) => this.toLessonSeries(x));
	}

	async listSeriesBookings(seriesId: string): Promise<AdminBooking[]> {
		return this.bookings
			.filter((b) => b.seriesId === seriesId)
			.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
			.map((b) => this.toAdminBooking(b));
	}

	async listSeriesNeedingTopUp(through: string): Promise<LessonSeries[]> {
		return this.series
			.filter(
				(x) => !x.endedAt && (x.materializedThrough === null || x.materializedThrough < through)
			)
			.map((x) => this.toLessonSeries(x));
	}

	async endSeries(id: string, from: Date, now: Date): Promise<AdminBooking[]> {
		const stored = this.series.find((x) => x.id === id);
		if (!stored) throw new SeriesStoreError('not_found');
		stored.endedAt ??= now;
		const cancelled = this.bookings.filter(
			(b) => b.seriesId === id && isLive(b) && b.startsAt >= from && b.startsAt > now
		);
		for (const b of cancelled) {
			b.status = 'cancelled';
			b.lateCancel = false;
		}
		return cancelled
			.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
			.map((b) => this.toAdminBooking(b));
	}

	/** Mirrors create_series_occurrences: skip clashes and starts not after now, then advance. */
	private materialise(
		stored: StoredSeries,
		startsAt: Date[],
		through: string,
		now: Date
	): OccurrenceResult[] {
		const lessonType = this.data.lessonTypes.find((t) => t.id === stored.lessonTypeId)!;
		const results = startsAt.map((start): OccurrenceResult => {
			if (start <= now) return { startsAt: start, bookingId: null };
			let window;
			try {
				window = this.requireFreeSlot(start, lessonType.durationMin);
			} catch (e) {
				if (e instanceof BookingStoreError) return { startsAt: start, bookingId: null };
				throw e;
			}
			const booking: StoredBooking = {
				id: crypto.randomUUID(),
				manageToken: crypto.randomUUID().replaceAll('-', ''),
				studentId: stored.studentId,
				lessonTypeId: stored.lessonTypeId,
				startsAt: start,
				...window,
				status: 'approved',
				priceCents: stored.priceCents,
				note: stored.note,
				paidAt: null,
				declineReason: null,
				decidedAt: now,
				lateCancel: false,
				gcalEventId: null,
				seriesId: stored.id
			};
			this.bookings.push(booking);
			return { startsAt: start, bookingId: booking.id };
		});
		if (stored.materializedThrough === null || stored.materializedThrough < through) {
			stored.materializedThrough = through;
		}
		return results.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
	}

	private toLessonSeries(stored: StoredSeries): LessonSeries {
		const student = this.data.students.find((s) => s.id === stored.studentId)!;
		const account = this.data.accounts.find((a) => a.id === student.accountId)!;
		const lessonType = this.data.lessonTypes.find((t) => t.id === stored.lessonTypeId)!;
		return {
			id: stored.id,
			studentId: stored.studentId,
			lessonTypeId: stored.lessonTypeId,
			weekday: stored.weekday,
			startTime: stored.startTime,
			intervalWeeks: stored.intervalWeeks,
			startsOn: stored.startsOn,
			endsOn: stored.endsOn,
			occurrenceCount: stored.occurrenceCount,
			note: stored.note,
			studentName: student.name,
			accountId: account.id,
			accountName: account.name,
			accountEmail: account.email,
			lessonTypeName: lessonType.name,
			durationMin: lessonType.durationMin,
			priceCents: stored.priceCents,
			materializedThrough: stored.materializedThrough,
			createdAt: stored.createdAt,
			endedAt: stored.endedAt
		};
	}

	/** Throws slot_taken on overlap with a live booking; otherwise returns the booked window. */
	private requireFreeSlot(startsAt: Date, durationMin: number) {
		const endsAt = new Date(startsAt.getTime() + durationMin * MINUTE_MS);
		const blockedUntil = new Date(endsAt.getTime() + this.data.settings.bufferMin * MINUTE_MS);
		const clash = this.bookings.some(
			(b) => isLive(b) && startsAt < b.blockedUntil && b.startsAt < blockedUntil
		);
		if (clash) throw new BookingStoreError('slot_taken');
		return { endsAt, blockedUntil };
	}

	/** Mirrors the unique index on (account, lower(btrim(name))); exceptId is the row being renamed. */
	private requireUniqueStudentName(accountId: string, trimmed: string, exceptId?: string) {
		const wanted = trimmed.toLowerCase();
		const taken = this.data.students.some(
			(s) =>
				s.accountId === accountId && s.id !== exceptId && s.name.trim().toLowerCase() === wanted
		);
		if (taken) throw new AccountStoreError('duplicate_student');
	}

	private findByTarget(target: CancelTarget): StoredBooking | undefined {
		if (target.kind === 'token') {
			return this.bookings.find((b) => b.manageToken === target.manageToken);
		}
		const booking = this.bookings.find((b) => b.id === target.bookingId);
		const student = booking && this.data.students.find((s) => s.id === booking.studentId);
		return student?.accountId === target.accountId ? booking : undefined;
	}

	private toStudent(student: { id: string; accountId: string; name: string }): Student {
		return { ...student, notes: this.studentNotes.get(student.id) ?? '' };
	}

	private toAccountWithStudents(account: Account): AccountWithStudents {
		const students = this.data.students
			.filter((s) => s.accountId === account.id)
			.map((s) => ({
				...this.toStudent(s),
				prices: this.data.studentPrices.filter((p) => p.studentId === s.id).map((p) => ({ ...p }))
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
		return { ...account, adminNotes: this.accountNotes.get(account.id) ?? '', students };
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
			manageToken: booking.manageToken,
			gcalEventId: booking.gcalEventId,
			series: this.seriesTag(booking.seriesId)
		};
	}

	private seriesTag(seriesId: string | null): SeriesTag | null {
		const stored = seriesId ? this.series.find((x) => x.id === seriesId) : undefined;
		return stored
			? {
					id: stored.id,
					weekday: stored.weekday,
					startTime: stored.startTime,
					intervalWeeks: stored.intervalWeeks
				}
			: null;
	}
}
