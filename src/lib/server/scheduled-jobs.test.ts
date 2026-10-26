import { describe, expect, it, vi } from 'vitest';
import { runScheduledJobs } from './scheduled-jobs';
import { demoData } from './store/demo-data';
import { MemoryBookingStore } from './store/memory';

const now = new Date('2026-11-01T12:00:00Z');

describe('runScheduledJobs', () => {
	it('reads settings then expires', async () => {
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
		await runScheduledJobs(store, now);
		expect(calls).toEqual(['getSettings', 'expire']);
	});

	it('returns the count', async () => {
		const store = new MemoryBookingStore(demoData());
		vi.spyOn(store, 'expirePendingBookings').mockResolvedValue(3);
		expect(await runScheduledJobs(store, now)).toEqual({ expired: 3 });
	});
});
