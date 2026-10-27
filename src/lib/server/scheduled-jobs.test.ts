import { describe, expect, it, vi } from 'vitest';
import { runScheduledJobs } from './scheduled-jobs';
import { demoData } from './store/demo-data';
import { MemoryBookingStore } from './store/memory';

const now = new Date('2026-11-01T12:00:00Z');

describe('runScheduledJobs', () => {
	it('reads settings then expires, before topping up series', async () => {
		const store = new MemoryBookingStore(demoData());
		const calls: string[] = [];
		vi.spyOn(store, 'getSettings').mockImplementation(async () => {
			calls.push('getSettings');
			return MemoryBookingStore.prototype.getSettings.call(store);
		});
		vi.spyOn(store, 'expirePendingBookings').mockImplementation(async () => {
			calls.push('expire');
			return 0;
		});
		await runScheduledJobs({ store, appUrl: 'https://example.test' }, now);
		expect(calls.slice(0, 2)).toEqual(['getSettings', 'expire']);
	});

	it('returns the count', async () => {
		const store = new MemoryBookingStore(demoData());
		vi.spyOn(store, 'expirePendingBookings').mockResolvedValue(3);
		expect(await runScheduledJobs({ store, appUrl: 'https://example.test' }, now)).toEqual({
			expired: 3,
			seriesToppedUp: 1,
			lessonsAdded: 12
		});
	});
});
