import { describe, it, expect, beforeEach } from 'vitest';
import type { AppStore, UsageEventInput } from './types';

const PARENT = '22222222-0000-0000-0000-00000000000b';
const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date('2026-11-01T17:00:00Z');

function event(overrides: Partial<UsageEventInput> = {}): UsageEventInput {
	return {
		kind: 'page_view',
		occurredAt: T0,
		accountId: null,
		visitId: 'visit-aaaaaaaa',
		route: '/book',
		durationMs: 1200,
		detail: null,
		...overrides
	};
}

/** Behaviour every UsageStore implementation must share. Seeded with supabase/seed.sql data. */
export function runUsageStoreContract(
	name: string,
	makeStore: () => Promise<AppStore>,
	reset?: () => Promise<void>
) {
	describe(`UsageStore contract: ${name}`, () => {
		if (reset) beforeEach(reset);

		it('starts empty', async () => {
			const store = await makeStore();
			expect(await store.lastUsageEventAt()).toBeNull();
			expect(await store.listUsageEvents(new Date(0), T0, 10)).toEqual({
				events: [],
				truncated: false
			});
		});

		it('records events and lists those in [from, to), oldest first', async () => {
			const store = await makeStore();
			await store.recordUsageEvent(event({ occurredAt: new Date(T0.getTime() + 1000) }));
			await store.recordUsageEvent(
				event({
					kind: 'sign_in',
					occurredAt: T0,
					accountId: PARENT,
					visitId: null,
					route: null,
					durationMs: null
				})
			);
			await store.recordUsageEvent(event({ occurredAt: new Date(T0.getTime() - DAY) }));
			await store.recordUsageEvent(event({ occurredAt: new Date(T0.getTime() + DAY) }));

			const { events, truncated } = await store.listUsageEvents(
				T0,
				new Date(T0.getTime() + DAY),
				10
			);
			expect(truncated).toBe(false);
			expect(events.map((e) => e.kind)).toEqual(['sign_in', 'page_view']);
			expect(events[0]).toMatchObject({
				occurredAt: T0,
				accountId: PARENT,
				visitId: null,
				route: null,
				durationMs: null,
				detail: null
			});
			expect(events[1]).toMatchObject({
				visitId: 'visit-aaaaaaaa',
				route: '/book',
				durationMs: 1200
			});
			expect(typeof events[0].id).toBe('string');
			expect(await store.lastUsageEventAt()).toEqual(new Date(T0.getTime() + DAY));
		});

		it('says when the limit cut the list short', async () => {
			const store = await makeStore();
			for (let i = 0; i < 3; i++) {
				await store.recordUsageEvent(event({ occurredAt: new Date(T0.getTime() + i) }));
			}
			const page = await store.listUsageEvents(T0, new Date(T0.getTime() + DAY), 2);
			expect(page.events).toHaveLength(2);
			expect(page.truncated).toBe(true);
			expect((await store.listUsageEvents(T0, new Date(T0.getTime() + DAY), 3)).truncated).toBe(
				false
			);
		});

		it('deletes events before a time', async () => {
			const store = await makeStore();
			await store.recordUsageEvent(event({ occurredAt: new Date(T0.getTime() - DAY) }));
			await store.recordUsageEvent(event({ occurredAt: T0 }));
			expect(await store.deleteUsageEventsBefore(T0)).toBe(1);
			const { events } = await store.listUsageEvents(new Date(0), new Date(T0.getTime() + DAY), 10);
			expect(events.map((e) => e.occurredAt)).toEqual([T0]);
		});

		it("forgets a deleted account's activity", async () => {
			const store = await makeStore();
			await store.recordUsageEvent(event({ accountId: PARENT }));
			await store.recordUsageEvent(event());
			await store.deleteAccount(PARENT, T0);
			const { events } = await store.listUsageEvents(new Date(0), new Date(T0.getTime() + DAY), 10);
			expect(events.map((e) => e.accountId)).toEqual([null]);
		});
	});
}
