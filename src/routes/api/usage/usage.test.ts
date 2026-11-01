import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '#lib/server/store/types.ts';
import { MemoryBookingStore } from '#lib/server/store/memory.ts';
import { demoData } from '#lib/server/store/demo-data.ts';

const ctx = vi.hoisted(() => ({ store: undefined as unknown as MemoryBookingStore }));
vi.mock('#lib/server/context.ts', () => ({ getStore: () => ctx.store }));

const mod = await import('./+server');

const family: Account = {
	id: '22222222-0000-0000-0000-00000000000b',
	name: 'Pat Parent',
	email: 'parent@example.com',
	role: 'client'
};

function call(body: string, account: Account | null = null) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return mod.POST({
		request: new Request('http://localhost/api/usage', { method: 'POST', body }),
		locals: { account }
	} as any);
}

async function events() {
	return (await ctx.store.listUsageEvents(new Date(0), new Date(Date.now() + 1000), 100)).events;
}

const beacon = { visitId: 'visit-12345678', route: '/book', durationMs: 900, newView: true };

describe('POST /api/usage', () => {
	beforeEach(() => {
		ctx.store = new MemoryBookingStore(demoData());
	});

	it('records a page view for the signed-in family', async () => {
		const res = await call(JSON.stringify(beacon), family);
		expect(res.status).toBe(204);
		expect(await events()).toMatchObject([
			{ kind: 'page_view', accountId: family.id, route: '/book', durationMs: 900 }
		]);
	});

	it('answers 400 to a malformed body and logs it', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect((await call('not json')).status).toBe(400);
		expect((await call(JSON.stringify({ ...beacon, route: 'x' }))).status).toBe(400);
		expect(warn).toHaveBeenCalledTimes(2);
		expect(await events()).toEqual([]);
		warn.mockRestore();
	});

	it('ignores the admin', async () => {
		const res = await call(JSON.stringify(beacon), { ...family, role: 'admin' });
		expect(res.status).toBe(204);
		expect(await events()).toEqual([]);
	});

	it('answers 204 even when the write fails, and logs it', async () => {
		vi.spyOn(ctx.store, 'recordUsageEvent').mockRejectedValue(new Error('db down'));
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
		expect((await call(JSON.stringify(beacon))).status).toBe(204);
		expect(errors).toHaveBeenCalled();
		errors.mockRestore();
	});
});
