import { describe, expect, it, vi } from 'vitest';
import { fakeCalendar } from './calendar/fake-client.test-helpers';
import { runScheduledJobs, USAGE_RETENTION_DAYS } from './scheduled-jobs';
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
			lessonsAdded: 12,
			seriesDeferred: 0,
			calendarAdded: 0,
			usagePurged: 0
		});
	});

	it('deletes usage events older than the retention period, and survives a failed delete', async () => {
		const store = new MemoryBookingStore(demoData());
		const old = new Date(now.getTime() - (USAGE_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);
		const base = { accountId: null, visitId: null, route: '/', durationMs: 0, detail: null };
		await store.recordUsageEvent({ ...base, kind: 'page_view', occurredAt: old });
		await store.recordUsageEvent({ ...base, kind: 'page_view', occurredAt: now });
		const deps = { store, appUrl: 'https://example.test' };
		expect((await runScheduledJobs(deps, now)).usagePurged).toBe(1);
		expect(
			(await store.listUsageEvents(new Date(0), new Date(now.getTime() + 1), 10)).events
		).toHaveLength(1);

		vi.spyOn(store, 'deleteUsageEventsBefore').mockRejectedValue(new Error('db down'));
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await runScheduledJobs(deps, now)).toMatchObject({ usagePurged: null, expired: 0 });
		expect(errors).toHaveBeenCalledWith(
			'cron: deleting old usage events failed',
			expect.any(Error)
		);
		errors.mockRestore();
	});

	it('puts lessons left off the calendar on it with the budget left after top-ups', async () => {
		const store = new MemoryBookingStore(demoData());
		await store.updateSettings({ ...(await store.getSettings()), gcalWriteCalendarId: 'c@x.com' });
		const calendar = fakeCalendar();
		// The demo series' 12 lessons get events during the top-up; this one was missed earlier.
		await store.createApprovedBooking(
			{
				accountId: '22222222-0000-0000-0000-00000000000b',
				studentId: '33333333-0000-0000-0000-0000000000a1',
				lessonTypeId: '11111111-0000-0000-0000-000000000030',
				startsAt: new Date('2026-11-05T23:00:00Z'),
				note: ''
			},
			now
		);
		const result = await runScheduledJobs({ store, calendar, appUrl: 'https://example.test' }, now);
		expect(result).toMatchObject({ lessonsAdded: 12, calendarAdded: 1 });
		expect(calendar.created).toHaveLength(13);
	});
});
