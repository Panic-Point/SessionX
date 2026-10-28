import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import {
	addFamilyStudent,
	bookForStudent,
	createFamily,
	type AdminBookingForm,
	type FamilyForm
} from './admin-family-service';
import type { AdminDeps } from './admin-service';
import { fakeCalendar } from './calendar/fake-client.test-helpers';
import type { EmailMessage, Mailer } from './email/mailer';
import { demoData } from './store/demo-data';
import { MemoryBookingStore } from './store/memory';

const now = DateTime.fromISO('2026-11-01T12:00', { zone: 'America/Los_Angeles' }).toJSDate();
const PAT = '22222222-0000-0000-0000-00000000000b';
const ADMIN = '22222222-0000-0000-0000-00000000000a';
const AVA = '33333333-0000-0000-0000-0000000000a1';
const BEN = '33333333-0000-0000-0000-0000000000b1';
const LESSON_30 = '11111111-0000-0000-0000-000000000030';
const CALENDAR = 'studio@example.com';

afterEach(() => vi.restoreAllMocks());

async function setup(failEmail = false) {
	const store = new MemoryBookingStore(demoData());
	await store.updateSettings({
		...(await store.getSettings()),
		gcalWriteCalendarId: CALENDAR,
		gcalBusyCalendarIds: [CALENDAR]
	});
	const calendar = fakeCalendar();
	const sent: EmailMessage[] = [];
	const mailer: Mailer = {
		async send(msg) {
			if (failEmail) throw new Error('smtp down');
			sent.push(msg);
		}
	};
	const deps: AdminDeps = { store, mailer, appUrl: 'https://example.test', calendar };
	return { store, calendar, sent, deps };
}

function family(overrides: Partial<FamilyForm> = {}): FamilyForm {
	return {
		name: ' Sam Smith ',
		email: ' Sam@Example.com ',
		studentName: ' Sky ',
		invite: true,
		...overrides
	};
}

function lesson(overrides: Partial<AdminBookingForm> = {}): AdminBookingForm {
	return {
		studentId: AVA,
		lessonTypeId: LESSON_30,
		date: '2026-11-03',
		time: '15:00',
		note: '',
		notify: 'on',
		...overrides
	};
}

describe('createFamily', () => {
	it('creates the account and first student and emails a link to set a password', async () => {
		const { store, sent, deps } = await setup();
		const result = await createFamily(deps, family());
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const account = (await store.getAccount(result.value.accountId))!;
		expect(account).toMatchObject({ name: 'Sam Smith', email: 'sam@example.com', role: 'client' });
		expect(account.students.map((s) => s.name)).toEqual(['Sky']);
		expect(await store.getPasswordHash(account.id)).toBeNull();
		expect(sent).toHaveLength(1);
		expect(sent[0].to).toBe('sam@example.com');
		expect(sent[0].text).toContain('https://example.test/register?email=sam%40example.com');
	});

	it('can skip the student and the invite', async () => {
		const { store, sent, deps } = await setup();
		const result = await createFamily(deps, family({ studentName: '  ', invite: false }));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect((await store.getAccount(result.value.accountId))!.students).toEqual([]);
		expect(sent).toHaveLength(0);
	});

	it('validates the fields', async () => {
		const { store, deps } = await setup();
		const before = (await store.listAccounts()).length;
		const result = await createFamily(
			deps,
			family({ name: ' ', email: 'not-an-email', studentName: 'x'.repeat(101) })
		);
		expect(result).toEqual({
			ok: false,
			errors: {
				name: "Enter the parent's name.",
				email: 'Enter a valid email address.',
				studentName: 'Keep the name under 100 characters.'
			}
		});
		expect(await store.listAccounts()).toHaveLength(before);
	});

	it('refuses an email that already has an account', async () => {
		const { sent, deps } = await setup();
		const result = await createFamily(deps, family({ email: 'PARENT@example.com' }));
		expect(result).toEqual({
			ok: false,
			errors: { email: 'A family with this email already exists.' }
		});
		expect(sent).toHaveLength(0);
	});

	it('an invite email failure only logs', async () => {
		const { deps } = await setup(true);
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		expect((await createFamily(deps, family())).ok).toBe(true);
		expect(log).toHaveBeenCalled();
	});
});

describe('addFamilyStudent', () => {
	it('adds a student to the family', async () => {
		const { store } = await setup();
		const result = await addFamilyStudent(store, PAT, '  Cleo ');
		expect(result.ok).toBe(true);
		expect((await store.listStudents(PAT)).map((s) => s.name)).toEqual(['Ava', 'Ben', 'Cleo']);
	});

	it('rejects blank and duplicate names', async () => {
		const { store } = await setup();
		expect(await addFamilyStudent(store, PAT, ' ')).toEqual({
			ok: false,
			errors: { name: "Enter the student's name." }
		});
		expect(await addFamilyStudent(store, PAT, 'ava')).toEqual({
			ok: false,
			errors: { name: 'This family already has a student with that name.' }
		});
	});

	it('refuses admins, unknown and deleted families', async () => {
		const { store } = await setup();
		const notFound = { ok: false, errors: { form: 'Family not found.' } };
		expect(await addFamilyStudent(store, ADMIN, 'Cleo')).toEqual(notFound);
		expect(await addFamilyStudent(store, '22222222-0000-0000-0000-0000000000ff', 'Cleo')).toEqual(
			notFound
		);
		await store.deleteAccount(PAT, now);
		expect(await addFamilyStudent(store, PAT, 'Cleo')).toEqual(notFound);
	});
});

describe('bookForStudent', () => {
	it('books a confirmed lesson, emails the family and adds it to the calendar', async () => {
		const { store, sent, calendar, deps } = await setup();
		const result = await bookForStudent(
			deps,
			PAT,
			lesson({ studentId: BEN, note: ' Bring music ' }),
			now
		);
		expect(result).toMatchObject({ ok: true, studentName: 'Ben' });
		if (!result.ok) return;
		expect(result.whenLabel).toContain('November 3');
		const booking = (await store.getBooking(result.bookingId))!;
		expect(booking).toMatchObject({
			status: 'approved',
			studentName: 'Ben',
			priceCents: 3000,
			note: 'Bring music',
			startsAt: new Date('2026-11-03T23:00:00Z'),
			gcalEventId: 'evt-1'
		});
		expect(sent).toHaveLength(1);
		expect(sent[0].to).toBe('parent@example.com');
		expect(sent[0].subject).toContain('Lesson confirmed');
		expect(sent[0].text).toContain(`https://example.test/manage/${booking.manageToken}`);
		expect(sent[0].attachments?.[0].filename).toBe('lesson.ics');
		expect(calendar.created).toHaveLength(1);
	});

	it('books quietly when emailing is off, still adding the calendar event', async () => {
		const { store, sent, calendar, deps } = await setup();
		const result = await bookForStudent(deps, PAT, lesson({ notify: '' }), now);
		expect(result.ok).toBe(true);
		if (result.ok) expect((await store.getBooking(result.bookingId))?.status).toBe('approved');
		expect(sent).toHaveLength(0);
		expect(calendar.created).toHaveLength(1);
	});

	it('ignores the public rules: notice, studio hours and the pending limit', async () => {
		const { store, deps } = await setup();
		await store.requestAccountBooking(
			{
				accountId: PAT,
				studentId: AVA,
				lessonTypeId: LESSON_30,
				startsAt: new Date('2026-11-10T23:00:00Z'),
				note: ''
			},
			now
		);
		await store.requestAccountBooking(
			{
				accountId: PAT,
				studentId: BEN,
				lessonTypeId: LESSON_30,
				startsAt: new Date('2026-11-11T23:00:00Z'),
				note: ''
			},
			now
		);
		// Later today, on a Sunday evening the studio is closed.
		const result = await bookForStudent(
			deps,
			PAT,
			lesson({ date: '2026-11-01', time: '19:30' }),
			now
		);
		expect(result.ok).toBe(true);
	});

	it('refuses past times', async () => {
		const { deps } = await setup();
		expect(
			await bookForStudent(deps, PAT, lesson({ date: '2026-11-01', time: '11:00' }), now)
		).toEqual({
			ok: false,
			errors: { time: 'That time has already passed.' }
		});
		expect(await bookForStudent(deps, PAT, lesson({ date: '2026-10-30' }), now)).toEqual({
			ok: false,
			errors: { date: 'That time has already passed.' }
		});
	});

	it('refuses clashes, closed dates and Google Calendar busy time', async () => {
		const { store, calendar, sent, deps } = await setup();
		expect((await bookForStudent(deps, PAT, lesson(), now)).ok).toBe(true);
		expect(await bookForStudent(deps, PAT, lesson({ studentId: BEN, time: '15:15' }), now)).toEqual(
			{
				ok: false,
				errors: { form: "Can't book then: Clashes with an existing lesson." }
			}
		);

		await store.saveDateOverride({ date: '2026-11-04', isClosed: true, ranges: [], note: '' });
		expect(await bookForStudent(deps, PAT, lesson({ date: '2026-11-04' }), now)).toEqual({
			ok: false,
			errors: { form: "Can't book then: Studio closed that day." }
		});

		calendar.busyIntervals = [
			{ start: new Date('2026-11-05T23:00:00Z'), end: new Date('2026-11-06T00:00:00Z') }
		];
		expect(await bookForStudent(deps, PAT, lesson({ date: '2026-11-05' }), now)).toEqual({
			ok: false,
			errors: { form: "Can't book then: Busy on Google Calendar." }
		});
		expect(sent).toHaveLength(1);
	});

	it('validates the form', async () => {
		const { deps } = await setup();
		expect(
			await bookForStudent(
				deps,
				PAT,
				{
					studentId: '',
					lessonTypeId: '',
					date: '2026-02-30',
					time: '3pm',
					note: 'x'.repeat(1001),
					notify: 'on'
				},
				now
			)
		).toEqual({
			ok: false,
			errors: {
				studentId: 'Choose a student.',
				lessonTypeId: 'Choose a lesson type.',
				date: 'Choose a date.',
				time: 'Use a time like 15:00.',
				note: 'Notes must be 1000 characters or fewer.'
			}
		});
	});

	it('refuses a time skipped by the clocks changing', async () => {
		const { deps } = await setup();
		expect(
			await bookForStudent(deps, PAT, lesson({ date: '2027-03-14', time: '02:30' }), now)
		).toEqual({
			ok: false,
			errors: { time: 'That time does not exist on this date (clocks change).' }
		});
	});

	it("refuses another family's student, a deleted family and inactive lesson types", async () => {
		const { store, deps } = await setup();
		const other = await createFamily(deps, family({ invite: false }));
		if (!other.ok) throw new Error('setup');
		const notFound = { ok: false, errors: { studentId: 'Student not found.' } };
		expect(await bookForStudent(deps, other.value.accountId, lesson(), now)).toEqual(notFound);

		const types = await store.listAllLessonTypes();
		const t = types.find((x) => x.id === LESSON_30)!;
		await store.updateLessonType(LESSON_30, { ...t, active: false });
		expect(await bookForStudent(deps, PAT, lesson(), now)).toEqual({
			ok: false,
			errors: { lessonTypeId: 'Choose an active lesson type.' }
		});

		await store.deleteAccount(PAT, now);
		expect(await bookForStudent(deps, PAT, lesson(), now)).toEqual(notFound);
	});

	it('an email failure after booking only logs', async () => {
		const { store, deps } = await setup(true);
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const result = await bookForStudent(deps, PAT, lesson(), now);
		expect(result.ok).toBe(true);
		if (result.ok) expect((await store.getBooking(result.bookingId))?.status).toBe('approved');
		expect(log).toHaveBeenCalled();
	});
});
