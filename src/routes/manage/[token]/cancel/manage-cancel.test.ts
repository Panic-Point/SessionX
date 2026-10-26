import { isActionFailure, isRedirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessage } from '#lib/server/email/mailer.ts';
import { MemoryBookingStore } from '#lib/server/store/memory.ts';

const ctx = vi.hoisted(() => ({
	store: undefined as unknown as MemoryBookingStore,
	sent: [] as EmailMessage[]
}));
vi.mock('#lib/server/context.ts', () => ({
	getStore: () => ctx.store,
	getMailer: () => ({ send: async (m: EmailMessage) => void ctx.sent.push(m) }),
	getAppUrl: () => 'https://example.test'
}));

const { actions } = await import('./+page.server');

/** An approved booking starting `hours` from now; returns its id and manage token. */
async function approvedBooking(hours: number) {
	const now = new Date();
	const created = await ctx.store.requestAccountBooking(
		{
			accountId: '22222222-0000-0000-0000-00000000000b',
			studentId: '33333333-0000-0000-0000-0000000000a1',
			lessonTypeId: '11111111-0000-0000-0000-000000000030',
			startsAt: new Date(now.getTime() + hours * 3_600_000),
			note: ''
		},
		now
	);
	await ctx.store.decideBooking(created.bookingId, 'approved', null, now);
	return { id: created.bookingId, token: created.manageToken };
}

async function submit(token: string, shownLate: string): Promise<unknown> {
	const body = new FormData();
	body.set('shownLate', shownLate);
	const event = {
		params: { token },
		request: new Request(`http://localhost/manage/${token}/cancel`, { method: 'POST', body })
	};
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return await (actions.default as any)(event);
	} catch (e) {
		return e;
	}
}

beforeEach(() => {
	ctx.store = new MemoryBookingStore();
	ctx.sent = [];
});

describe('/manage/[token]/cancel lateness check', () => {
	it('re-renders instead of cancelling when the page showed no late warning', async () => {
		const b = await approvedBooking(5);
		const result = await submit(b.token, 'false');
		expect(isActionFailure(result)).toBe(true);
		expect(result).toMatchObject({ status: 400, data: { lateChanged: true } });
		expect((await ctx.store.getBooking(b.id))!.status).toBe('approved');
		expect(ctx.sent).toEqual([]);
	});

	it('cancels when the shown warning still matches', async () => {
		const b = await approvedBooking(72);
		expect(isRedirect(await submit(b.token, 'false'))).toBe(true);
		expect((await ctx.store.getBooking(b.id))!.status).toBe('cancelled');
	});
});
