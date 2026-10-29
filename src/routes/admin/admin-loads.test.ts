import { isHttpError, isRedirect } from '@sveltejs/kit';
import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { demoData } from '#lib/server/store/demo-data.ts';
import { MemoryBookingStore } from '#lib/server/store/memory.ts';
import { RANGE_ORDER_ERROR } from '#lib/server/periods.ts';
import type { Account } from '#lib/server/store/types.ts';
import { load as requestsLoad } from './+page.server';
import { actions as familyActions, load as familyLoad } from './families/[id]/+page.server';
import { load as familiesLoad } from './families/+page.server';
import { load as hoursLoad } from './hours/+page.server';
import { load as lessonsLoad } from './lessons/+page.server';
import { load as lessonTypesLoad } from './lesson-types/+page.server';
import { load as settingsLoad } from './settings/+page.server';

const ctx = vi.hoisted(() => ({ store: undefined as unknown as MemoryBookingStore }));
vi.mock('#lib/server/context.ts', () => ({ getStore: () => ctx.store }));

// Defense in depth: every admin page load must enforce the guard itself, because a data request
// can skip the layout load and a hook bypass would otherwise leak the leaf's data.
const loads = {
	'/admin': requestsLoad,
	'/admin/hours': hoursLoad,
	'/admin/lessons': lessonsLoad,
	'/admin/lesson-types': lessonTypesLoad,
	'/admin/settings': settingsLoad,
	'/admin/families': familiesLoad,
	'/admin/families/f1': familyLoad
} as const;

const client: Account = { id: 'c1', name: 'Pat', email: 'pat@example.com', role: 'client' };

async function run(route: keyof typeof loads, account: Account | null): Promise<unknown> {
	const event = {
		locals: { account },
		url: new URL(`http://localhost${route}`),
		params: { id: 'f1' }
	};
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return await (loads[route] as any)(event);
	} catch (e) {
		return e;
	}
}

describe('admin page loads', () => {
	it.each(Object.keys(loads) as (keyof typeof loads)[])(
		'%s redirects a signed-out visitor to /login',
		async (route) => {
			const result = await run(route, null);
			expect(isRedirect(result)).toBe(true);
			expect(result).toMatchObject({ status: 303, location: '/login' });
		}
	);
	it.each(Object.keys(loads) as (keyof typeof loads)[])(
		'%s forbids a signed-in client',
		async (route) => {
			const result = await run(route, client);
			expect(isHttpError(result)).toBe(true);
			expect(result).toMatchObject({ status: 403 });
		}
	);
});

describe('admin family actions', () => {
	const names = [
		'accountNotes',
		'studentNotes',
		'prices',
		'addSong',
		'updateSong',
		'removeSong'
	] as const;
	function event(account: Account | null) {
		return {
			locals: { account },
			request: new Request('http://localhost/', { method: 'POST', body: new FormData() }),
			params: { id: 'f1' }
		};
	}
	it.each(names)('%s redirects a signed-out visitor', async (name) => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result = await (familyActions[name] as any)(event(null)).catch((e: unknown) => e);
		expect(isRedirect(result)).toBe(true);
	});
	it.each(names)('%s forbids a client', async (name) => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result = await (familyActions[name] as any)(event(client)).catch((e: unknown) => e);
		expect(isHttpError(result)).toBe(true);
		expect(result).toMatchObject({ status: 403 });
	});
});

describe('admin lessons period', () => {
	const admin: Account = { id: 'a1', name: 'Teacher', email: 'admin@example.com', role: 'admin' };
	const LESSON_30 = '11111111-0000-0000-0000-000000000030';
	const AVA = '33333333-0000-0000-0000-0000000000a1';
	const PAT = '22222222-0000-0000-0000-00000000000b';
	// Ten days out at 4pm studio time, so it is in the future and not in this week.
	const start = DateTime.now()
		.setZone(demoData().settings.timezone)
		.plus({ days: 10 })
		.set({ hour: 16, minute: 0, second: 0, millisecond: 0 });

	beforeEach(async () => {
		ctx.store = new MemoryBookingStore(demoData());
		const now = new Date();
		const c = await ctx.store.requestAccountBooking(
			{
				accountId: PAT,
				studentId: AVA,
				lessonTypeId: LESSON_30,
				startsAt: start.toJSDate(),
				note: ''
			},
			now
		);
		await ctx.store.decideBooking(c.bookingId, 'approved', null, now);
	});

	async function lessons(query: string) {
		const event = {
			locals: { account: admin },
			url: new URL(`http://localhost/admin/lessons?${query}`)
		};
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (await (lessonsLoad as any)(event)) as {
			range: string;
			unpaidOnly: boolean;
			period: { label: string; error: string | null } | null;
			periodQuery: Record<string, string>;
			summary: string | null;
			lessons: { id: string }[];
		};
	}

	it('keeps the default view without a period', async () => {
		const data = await lessons('');
		expect(data.period).toBeNull();
		expect(data.summary).toBeNull();
		expect(data.range).toBe('upcoming');
		expect(data.lessons.length).toBeGreaterThan(0);
	});

	it('lists the chosen week with a summary, combined with unpaid only', async () => {
		const data = await lessons(`period=week&date=${start.toFormat('yyyy-MM-dd')}&unpaid=1`);
		expect(data.period?.label).toBe(`Week of ${start.startOf('week').toFormat('LLL d, yyyy')}`);
		expect(data.unpaidOnly).toBe(true);
		expect(data.periodQuery).toEqual({ period: 'week', date: start.toFormat('yyyy-MM-dd') });
		expect(data.lessons.length).toBeGreaterThan(0);
		expect(data.summary).toMatch(new RegExp(`^${data.lessons.length} lessons? · \\$`));
	});

	it('never errors on bad params', async () => {
		for (const q of [
			'period=week&date=garbage',
			'period=month&date=2026-99',
			'period=custom&from=&to=',
			'period=nonsense&range=zzz&unpaid=yes'
		]) {
			await expect(lessons(q)).resolves.toBeTruthy();
		}
	});

	it('shows an error and no list when the custom start is after the end', async () => {
		const data = await lessons('period=custom&from=2026-11-20&to=2026-11-02');
		expect(data.period?.error).toBe(RANGE_ORDER_ERROR);
		expect(data.lessons).toEqual([]);
		expect(data.summary).toBeNull();
	});
});
