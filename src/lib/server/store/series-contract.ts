import { describe, it, expect, beforeEach } from 'vitest';
import { AccountStoreError, BookingStoreError, SeriesStoreError } from './types';
import type { AppStore, SeriesInput, SeriesStoreErrorCode } from './types';

const NOW = new Date('2026-11-01T17:00:00Z');
const PAT = '22222222-0000-0000-0000-00000000000b';
const BEN = '33333333-0000-0000-0000-0000000000b1';
const AVA = '33333333-0000-0000-0000-0000000000a1';
const LESSON_30 = '11111111-0000-0000-0000-000000000030';
const LESSON_45 = '11111111-0000-0000-0000-000000000045';
const DEMO_SERIES = '44444444-0000-0000-0000-0000000000b1';
const NO_SUCH_STUDENT = '33333333-0000-0000-0000-0000000000ff';
const NO_SUCH_SERIES = '44444444-0000-0000-0000-0000000000ff';
// Tuesdays at 3:00pm New York; US clocks change on 2030-03-10.
const TUE_1 = new Date('2030-03-05T20:00:00Z');
const TUE_2 = new Date('2030-03-12T19:00:00Z');
const TUE_3 = new Date('2030-03-19T19:00:00Z');
const TUE_4 = new Date('2030-03-26T19:00:00Z');

function input(overrides: Partial<SeriesInput> = {}): SeriesInput {
	return {
		studentId: BEN,
		lessonTypeId: LESSON_30,
		weekday: 2,
		startTime: '15:00',
		intervalWeeks: 1,
		startsOn: '2030-03-05',
		endsOn: null,
		occurrenceCount: 3,
		note: 'Bring the red book',
		...overrides
	};
}

async function seriesCode(promise: Promise<unknown>): Promise<SeriesStoreErrorCode | null> {
	try {
		await promise;
		return null;
	} catch (e) {
		return e instanceof SeriesStoreError ? e.code : null;
	}
}

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
		return null;
	} catch (e) {
		return e;
	}
}

/** Behaviour every SeriesStore implementation must share. Seeded with supabase/seed.sql data. */
export function runSeriesStoreContract(
	name: string,
	makeStore: () => Promise<AppStore>,
	reset?: () => Promise<void>
) {
	describe(`SeriesStore contract: ${name}`, () => {
		if (reset) beforeEach(reset);

		it('creates the series and approved occurrences at the student price', async () => {
			const store = await makeStore();
			const { series, occurrences } = await store.createSeries(
				input(),
				[TUE_1, TUE_2, TUE_3],
				'2030-03-19',
				NOW
			);
			expect(series).toMatchObject({
				studentId: BEN,
				studentName: 'Ben',
				accountId: PAT,
				accountName: 'Pat Parent',
				accountEmail: 'parent@example.com',
				lessonTypeId: LESSON_30,
				lessonTypeName: '30-minute lesson',
				durationMin: 30,
				weekday: 2,
				startTime: '15:00',
				intervalWeeks: 1,
				startsOn: '2030-03-05',
				endsOn: null,
				occurrenceCount: 3,
				priceCents: 3000,
				note: 'Bring the red book',
				materializedThrough: '2030-03-19',
				endedAt: null
			});
			expect(occurrences.map((o) => o.startsAt)).toEqual([TUE_1, TUE_2, TUE_3]);
			expect(occurrences.every((o) => o.bookingId !== null)).toBe(true);

			const bookings = await store.listSeriesBookings(series.id);
			expect(bookings.map((b) => b.id)).toEqual(occurrences.map((o) => o.bookingId));
			expect(bookings[0]).toMatchObject({
				status: 'approved',
				startsAt: TUE_1,
				endsAt: new Date('2030-03-05T20:30:00Z'),
				priceCents: 3000,
				note: 'Bring the red book',
				studentName: 'Ben',
				series: { id: series.id, weekday: 2, startTime: '15:00', intervalWeeks: 1 }
			});
			expect(await store.getSeries(series.id)).toEqual(series);
		});

		it('uses the list price without a custom price', async () => {
			const store = await makeStore();
			const { series } = await store.createSeries(input({ studentId: AVA }), [], '2030-03-05', NOW);
			expect(series.priceCents).toBe(3500);
		});

		it('skips starts that clash with a live booking or are not after now', async () => {
			const store = await makeStore();
			await store.requestGuestBooking(
				{
					email: 'other@example.com',
					accountName: 'Other',
					studentName: 'Zed',
					lessonTypeId: LESSON_45,
					startsAt: new Date('2030-03-12T18:30:00Z'),
					note: ''
				},
				NOW
			);
			const past = new Date('2026-10-27T19:00:00Z');
			const { series, occurrences } = await store.createSeries(
				input({ startsOn: '2026-10-27', occurrenceCount: null, endsOn: '2030-03-19' }),
				[past, TUE_1, TUE_2, TUE_3],
				'2030-03-19',
				NOW
			);
			expect(occurrences.map((o) => [o.startsAt, o.bookingId !== null])).toEqual([
				[past, false],
				[TUE_1, true],
				[TUE_2, false],
				[TUE_3, true]
			]);
			expect((await store.listSeriesBookings(series.id)).map((b) => b.startsAt)).toEqual([
				TUE_1,
				TUE_3
			]);
		});

		it('occurrences block those times for other bookings', async () => {
			const store = await makeStore();
			await store.createSeries(input(), [TUE_1], '2030-03-05', NOW);
			const live = await store.getLiveBookings(TUE_1, new Date(TUE_1.getTime() + 60_000));
			expect(live).toHaveLength(1);
			const err = await errorOf(
				store.requestAccountBooking(
					{ accountId: PAT, studentId: AVA, lessonTypeId: LESSON_30, startsAt: TUE_1, note: '' },
					NOW
				)
			);
			expect(err).toBeInstanceOf(BookingStoreError);
			expect((err as BookingStoreError).code).toBe('slot_taken');
		});

		it('rejects an unknown student, then an inactive lesson type, creating nothing', async () => {
			const store = await makeStore();
			const noStudent = await errorOf(
				store.createSeries(input({ studentId: NO_SUCH_STUDENT }), [TUE_1], '2030-03-05', NOW)
			);
			expect(noStudent).toBeInstanceOf(AccountStoreError);
			expect((noStudent as AccountStoreError).code).toBe('not_found');

			const lesson = (await store.listAllLessonTypes()).find((t) => t.id === LESSON_45)!;
			await store.updateLessonType(LESSON_45, { ...lesson, active: false });
			const inactive = await errorOf(
				store.createSeries(input({ lessonTypeId: LESSON_45 }), [TUE_1], '2030-03-05', NOW)
			);
			expect(inactive).toBeInstanceOf(BookingStoreError);
			expect((inactive as BookingStoreError).code).toBe('lesson_type_not_found');
			expect(await store.listSeriesForAccount(PAT)).toHaveLength(1);
			expect(await store.getLiveBookings(TUE_1, TUE_4)).toEqual([]);
		});

		it('lists the account series newest first, including the seeded one', async () => {
			const store = await makeStore();
			const { series } = await store.createSeries(input(), [], '2030-03-05', NOW);
			const listed = await store.listSeriesForAccount(PAT);
			expect(listed.map((x) => x.id)).toEqual([series.id, DEMO_SERIES]);
			expect(listed[1]).toMatchObject({ studentName: 'Ben', weekday: 2, startTime: '16:00' });
			expect(await store.listSeriesForAccount('22222222-0000-0000-0000-0000000000ff')).toEqual([]);
			expect(await store.listSeriesForAccount('not-a-uuid')).toEqual([]);
		});

		it('getSeries and listSeriesBookings return nothing for unknown ids', async () => {
			const store = await makeStore();
			expect(await store.getSeries(NO_SUCH_SERIES)).toBeNull();
			expect(await store.getSeries('not-a-uuid')).toBeNull();
			expect(await store.listSeriesBookings(NO_SUCH_SERIES)).toEqual([]);
		});

		it('adds occurrences to a series and advances materializedThrough', async () => {
			const store = await makeStore();
			const { series } = await store.createSeries(
				input({ occurrenceCount: null }),
				[TUE_1],
				'2030-03-05',
				NOW
			);
			const added = await store.addSeriesOccurrences(series.id, [TUE_2, TUE_3], '2030-03-19', NOW);
			expect(added.map((o) => o.bookingId !== null)).toEqual([true, true]);
			expect((await store.getSeries(series.id))!.materializedThrough).toBe('2030-03-19');
			expect(await store.listSeriesBookings(series.id)).toHaveLength(3);

			// Never moves backwards.
			await store.addSeriesOccurrences(series.id, [], '2030-03-12', NOW);
			expect((await store.getSeries(series.id))!.materializedThrough).toBe('2030-03-19');
		});

		it('adding to an unknown or ended series fails', async () => {
			const store = await makeStore();
			expect(
				await seriesCode(store.addSeriesOccurrences(NO_SUCH_SERIES, [], '2030-03-05', NOW))
			).toBe('not_found');
			const { series } = await store.createSeries(input(), [], '2030-03-05', NOW);
			await store.endSeries(series.id, NOW, NOW);
			expect(
				await seriesCode(store.addSeriesOccurrences(series.id, [TUE_2], '2030-03-12', NOW))
			).toBe('ended');
			expect(await store.listSeriesBookings(series.id)).toEqual([]);
		});

		it('lists live series that are not materialised through the date', async () => {
			const store = await makeStore();
			const { series } = await store.createSeries(input(), [], '2030-03-19', NOW);
			const ended = (await store.createSeries(input({ studentId: AVA }), [], '2030-03-05', NOW))
				.series;
			await store.endSeries(ended.id, NOW, NOW);

			const ids = async (through: string) =>
				(await store.listSeriesNeedingTopUp(through)).map((x) => x.id).sort();
			expect(await ids('2030-03-19')).toEqual([DEMO_SERIES]);
			expect(await ids('2030-03-20')).toEqual([DEMO_SERIES, series.id].sort());
		});

		it('endSeries cancels later live occurrences only, never late, and keeps the first end time', async () => {
			const store = await makeStore();
			const { series } = await store.createSeries(
				input({ occurrenceCount: 4 }),
				[TUE_1, TUE_2, TUE_3, TUE_4],
				'2030-03-26',
				NOW
			);
			const first = await store.listSeriesBookings(series.id);
			// A single occurrence the family already cancelled stays as it is.
			await store.cancelBooking({ kind: 'token', manageToken: first[3].manageToken }, true, NOW);

			// Now is after the first lesson; ending "from the first" leaves it, as it is past.
			const after1 = new Date(TUE_1.getTime() + 3_600_000);
			const cancelled = await store.endSeries(series.id, TUE_1, after1);
			expect(cancelled.map((b) => b.startsAt)).toEqual([TUE_2, TUE_3]);
			expect(cancelled.every((b) => b.status === 'cancelled' && !b.lateCancel)).toBe(true);

			const after = await store.listSeriesBookings(series.id);
			expect(after.map((b) => [b.status, b.lateCancel])).toEqual([
				['approved', false],
				['cancelled', false],
				['cancelled', false],
				['cancelled', true]
			]);
			const ended = (await store.getSeries(series.id))!;
			expect(ended.endedAt).toEqual(after1);

			// Ending again cancels nothing more and keeps the first end time.
			expect(await store.endSeries(series.id, NOW, new Date(after1.getTime() + 1000))).toEqual([]);
			expect((await store.getSeries(series.id))!.endedAt).toEqual(after1);
			// The freed times are bookable again.
			expect(await store.getLiveBookings(TUE_2, TUE_4)).toEqual([]);
		});

		it('endSeries from a later date keeps the earlier occurrences', async () => {
			const store = await makeStore();
			const { series } = await store.createSeries(
				input(),
				[TUE_1, TUE_2, TUE_3],
				'2030-03-19',
				NOW
			);
			const cancelled = await store.endSeries(series.id, TUE_2, NOW);
			expect(cancelled.map((b) => b.startsAt)).toEqual([TUE_2, TUE_3]);
			expect((await store.listSeriesBookings(series.id)).map((b) => b.status)).toEqual([
				'approved',
				'cancelled',
				'cancelled'
			]);
		});

		it('endSeries on an unknown series fails', async () => {
			const store = await makeStore();
			expect(await seriesCode(store.endSeries(NO_SUCH_SERIES, NOW, NOW))).toBe('not_found');
		});
	});
}
