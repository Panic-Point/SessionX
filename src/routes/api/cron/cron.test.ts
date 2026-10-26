import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryBookingStore } from '#lib/server/store/memory.ts';
import { demoData } from '#lib/server/store/demo-data.ts';

const ctx = vi.hoisted(() => ({
	store: undefined as unknown as MemoryBookingStore,
	secret: 'cron-test-secret' as string | undefined
}));
vi.mock('#lib/server/context.ts', () => ({ getStore: () => ctx.store }));
vi.mock('$app/env/private', () => ({
	get CRON_SECRET() {
		return ctx.secret;
	}
}));

const mod = await import('./+server');

const LESSON_30 = '11111111-0000-0000-0000-000000000030';

async function seedPastPending(): Promise<string> {
	const past = new Date(Date.now() - 24 * 3600 * 1000);
	const { bookingId } = await ctx.store.requestGuestBooking(
		{
			email: 'cron@example.com',
			accountName: 'Cron Parent',
			studentName: 'Kid',
			lessonTypeId: LESSON_30,
			startsAt: past,
			note: ''
		},
		new Date(past.getTime() - 3600 * 1000)
	);
	return bookingId;
}

function call(authorization?: string) {
	const headers = new Headers();
	if (authorization) headers.set('authorization', authorization);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return mod.POST({
		request: new Request('http://localhost/api/cron', { method: 'POST', headers })
	} as any);
}

describe('POST /api/cron', () => {
	beforeEach(() => {
		ctx.store = new MemoryBookingStore(demoData());
		ctx.secret = 'cron-test-secret';
	});

	it('rejects a wrong secret with 401 and leaves the pending request pending', async () => {
		const id = await seedPastPending();
		const res = await call('Bearer nope');
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ ok: false });
		expect((await ctx.store.getBooking(id))?.status).toBe('pending');
	});

	it('returns 503 when no secret is configured', async () => {
		ctx.secret = undefined;
		const res = await call('Bearer anything');
		expect(res.status).toBe(503);
	});

	it('expires past pending requests with the right secret', async () => {
		const id = await seedPastPending();
		const res = await call('Bearer cron-test-secret');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, expired: 1 });
		expect((await ctx.store.getBooking(id))?.status).toBe('expired');
	});

	it('does not export GET', () => {
		expect('GET' in mod).toBe(false);
	});
});
