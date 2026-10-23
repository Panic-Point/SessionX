import { describe, it, expect } from 'vitest';
import { runBookingStoreContract } from './contract';
import { MemoryBookingStore } from './memory';
import { demoData } from './demo-data';

runBookingStoreContract('memory', async () => new MemoryBookingStore(demoData()));

describe('MemoryBookingStore specifics', () => {
	it('rejected request by a new email leaves no account behind', async () => {
		const store = new MemoryBookingStore(demoData());
		const base = {
			lessonTypeId: '11111111-0000-0000-0000-000000000030',
			startsAt: new Date('2030-03-04T20:00:00Z'),
			note: ''
		};
		const now = new Date('2026-11-01T17:00:00Z');
		await store.requestGuestBooking(
			{ ...base, email: 'a@example.com', accountName: 'A', studentName: 'A' },
			now
		);
		const before = store['data'].accounts.length;
		await expect(
			store.requestGuestBooking(
				{ ...base, email: 'new@example.com', accountName: 'Alice', studentName: 'Al' },
				now
			)
		).rejects.toMatchObject({ code: 'slot_taken' });
		expect(store['data'].accounts).toHaveLength(before);
	});

	it('filters date overrides to the inclusive range', async () => {
		const data = demoData();
		data.dateOverrides = [
			{ date: '2030-01-01', isClosed: true, ranges: [] },
			{ date: '2030-01-15', isClosed: true, ranges: [] },
			{ date: '2030-02-01', isClosed: false, ranges: [{ start: '10:00', end: '12:00' }] },
			{ date: '2030-02-02', isClosed: true, ranges: [] }
		];
		const store = new MemoryBookingStore(data);
		const found = await store.getDateOverrides('2030-01-15', '2030-02-01');
		expect(found.map((o) => o.date)).toEqual(['2030-01-15', '2030-02-01']);
	});

	it('reuses an existing seeded student by case-insensitive name', async () => {
		const store = new MemoryBookingStore(demoData());
		const created = await store.requestGuestBooking(
			{
				email: 'PARENT@example.com',
				accountName: 'ignored',
				studentName: ' ben ',
				lessonTypeId: '11111111-0000-0000-0000-000000000030',
				startsAt: new Date('2030-03-04T20:00:00Z'),
				note: ''
			},
			new Date('2026-11-01T17:00:00Z')
		);
		const summary = await store.getBookingByManageToken(created.manageToken);
		expect(summary).toMatchObject({ studentName: 'Ben' });
		expect(summary).not.toHaveProperty('accountName');
		// Matched the seeded account by email; the submitted name was ignored.
		expect(store['data'].accounts.map((a) => a.name)).toEqual(['Studio Admin', 'Pat Parent']);
	});
});
