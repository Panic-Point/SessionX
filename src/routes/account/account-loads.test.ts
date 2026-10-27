import { isRedirect } from '@sveltejs/kit';
import { DateTime } from 'luxon';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { demoData } from '#lib/server/store/demo-data.ts';
import { MemoryBookingStore } from '#lib/server/store/memory.ts';
import type { Account } from '#lib/server/store/types.ts';
import { actions as homeActions, load as homeLoad } from './+page.server';
import { actions as cancelActions, load as cancelLoad } from './cancel/[id]/+page.server';

const ctx = vi.hoisted(() => ({ store: undefined as unknown as MemoryBookingStore }));
vi.mock('#lib/server/context.ts', () => ({ getStore: () => ctx.store }));

// Defense in depth: every /account load and action enforces the guard itself, because a data
// request can skip layout loads. A signed-out visitor must be redirected before any store access.
const handlers = {
	'load /account': homeLoad,
	'action /account?/addStudent': homeActions.addStudent,
	'action /account?/renameStudent': homeActions.renameStudent,
	'action /account?/password': homeActions.password,
	'load /account/cancel/[id]': cancelLoad,
	'action /account/cancel/[id]': cancelActions.default
} as const;

async function run(name: keyof typeof handlers): Promise<unknown> {
	const event = {
		locals: { account: null },
		params: { id: 'b1' },
		url: new URL('http://localhost/account'),
		request: new Request('http://localhost/account', { method: 'POST', body: new FormData() })
	};
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return await (handlers[name] as any)(event);
	} catch (e) {
		return e;
	}
}

describe('account loads and actions', () => {
	it.each(Object.keys(handlers) as (keyof typeof handlers)[])(
		'%s redirects a signed-out visitor to /login',
		async (name) => {
			const result = await run(name);
			expect(isRedirect(result)).toBe(true);
			expect(result).toMatchObject({ status: 303, location: '/login' });
		}
	);
});

describe('account lessons period', () => {
	const pat: Account = {
		id: '22222222-0000-0000-0000-00000000000b',
		name: 'Pat Parent',
		email: 'parent@example.com',
		role: 'client'
	};
	const LESSON_30 = '11111111-0000-0000-0000-000000000030';
	const AVA = '33333333-0000-0000-0000-0000000000a1';
	const start = DateTime.now()
		.setZone(demoData().settings.timezone)
		.plus({ days: 10 })
		.set({ hour: 16, minute: 0, second: 0, millisecond: 0 });
	let patBooking = '';
	let otherBooking = '';

	beforeEach(async () => {
		ctx.store = new MemoryBookingStore(demoData());
		const now = new Date();
		const mine = await ctx.store.requestAccountBooking(
			{
				accountId: pat.id,
				studentId: AVA,
				lessonTypeId: LESSON_30,
				startsAt: start.toJSDate(),
				note: ''
			},
			now
		);
		patBooking = mine.bookingId;
		const theirs = await ctx.store.requestGuestBooking(
			{
				email: 'other@example.com',
				accountName: 'Other Family',
				studentName: 'Zed',
				lessonTypeId: LESSON_30,
				startsAt: start.plus({ hours: 2 }).toJSDate(),
				note: ''
			},
			now
		);
		otherBooking = theirs.bookingId;
	});

	async function home(query: string) {
		const event = { locals: { account: pat }, url: new URL(`http://localhost/account?${query}`) };
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (await (homeLoad as any)(event)) as {
			period: { label: string; error: string | null } | null;
			inPeriod: { id: string; statusLabel: string }[] | null;
			upcoming: { id: string }[];
		};
	}

	it('keeps upcoming and past without a period', async () => {
		const data = await home('');
		expect(data.period).toBeNull();
		expect(data.inPeriod).toBeNull();
		expect(data.upcoming.map((b) => b.id)).toContain(patBooking);
	});

	it("lists only the family's own lessons in the chosen month", async () => {
		const data = await home(`period=month&date=${start.toFormat('yyyy-MM')}`);
		expect(data.period?.label).toBe(start.toFormat('LLLL yyyy'));
		const ids = data.inPeriod?.map((b) => b.id) ?? [];
		expect(ids).toContain(patBooking);
		expect(ids).not.toContain(otherBooking);
		expect(data.upcoming).toEqual([]);
	});

	it('never errors on bad params, and shows no list for a reversed range', async () => {
		await expect(home('period=week&date=2026-02-31')).resolves.toBeTruthy();
		const data = await home('period=custom&from=2026-11-20&to=2026-11-02');
		expect(data.period?.error).toBeTruthy();
		expect(data.inPeriod).toBeNull();
	});
});
