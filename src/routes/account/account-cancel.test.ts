import { isActionFailure, isHttpError, isRedirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeCalendar, type FakeCalendar } from '#lib/server/calendar/fake-client.test-helpers.ts';
import type { EmailMessage } from '#lib/server/email/mailer.ts';
import { demoData } from '#lib/server/store/demo-data.ts';
import { MemoryBookingStore } from '#lib/server/store/memory.ts';
import type { Account } from '#lib/server/store/types.ts';

const ctx = vi.hoisted(() => ({
	store: undefined as unknown as MemoryBookingStore,
	sent: [] as EmailMessage[],
	calendar: undefined as unknown as FakeCalendar
}));
vi.mock('#lib/server/context.ts', () => ({
	getStore: () => ctx.store,
	getMailer: () => ({ send: async (m: EmailMessage) => void ctx.sent.push(m) }),
	getAppUrl: () => 'https://example.test',
	getCalendar: () => ctx.calendar
}));

const { actions, load } = await import('./cancel/[id]/+page.server');

const LESSON_30 = '11111111-0000-0000-0000-000000000030';
const AVA = '33333333-0000-0000-0000-0000000000a1';
const pat: Account = {
	id: '22222222-0000-0000-0000-00000000000b',
	name: 'Pat Parent',
	email: 'parent@example.com',
	role: 'client'
};
const robin: Account = {
	id: '22222222-0000-0000-0000-00000000000c',
	name: 'Robin Other',
	email: 'robin@example.com',
	role: 'client'
};

/** Pat's approved booking for Ava, starting `hours` from now. */
async function patBooking(hours: number): Promise<string> {
	const now = new Date();
	const created = await ctx.store.requestAccountBooking(
		{
			accountId: pat.id,
			studentId: AVA,
			lessonTypeId: LESSON_30,
			startsAt: new Date(now.getTime() + hours * 3_600_000),
			note: ''
		},
		now
	);
	await ctx.store.decideBooking(created.bookingId, 'approved', null, now);
	return created.bookingId;
}

function event(account: Account, id: string, fields: Record<string, string> = {}) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return {
		locals: { account },
		params: { id },
		request: new Request(`http://localhost/account/cancel/${id}`, { method: 'POST', body })
	};
}

async function call(fn: unknown, e: ReturnType<typeof event>): Promise<unknown> {
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return await (fn as any)(e);
	} catch (err) {
		return err;
	}
}

beforeEach(() => {
	const data = demoData();
	data.accounts.push({ ...robin });
	ctx.store = new MemoryBookingStore(data);
	ctx.sent = [];
	ctx.calendar = fakeCalendar(false);
});

describe('/account/cancel/[id] for another family', () => {
	it("load 404s on Pat's booking", async () => {
		const id = await patBooking(72);
		const result = await call(load, event(robin, id));
		expect(isHttpError(result)).toBe(true);
		expect(result).toMatchObject({ status: 404 });
	});

	it("action refuses Pat's booking and leaves it untouched", async () => {
		const id = await patBooking(72);
		const result = await call(actions.default, event(robin, id, { shownLate: 'false' }));
		expect(isActionFailure(result)).toBe(true);
		expect(result).toMatchObject({ status: 400, data: { message: 'Booking not found.' } });
		expect((await ctx.store.getBooking(id))!.status).toBe('approved');
		expect(ctx.sent).toEqual([]);
	});
});

describe('/account/cancel/[id] lateness check', () => {
	it('re-renders instead of cancelling when the page showed no late warning', async () => {
		const id = await patBooking(5);
		const result = await call(actions.default, event(pat, id, { shownLate: 'false' }));
		expect(isActionFailure(result)).toBe(true);
		expect(result).toMatchObject({
			status: 400,
			data: {
				message: 'Please review: this cancellation is now inside the cancellation policy.',
				lateChanged: true
			}
		});
		expect((await ctx.store.getBooking(id))!.status).toBe('approved');
		expect(ctx.sent).toEqual([]);
		const reloaded = (await call(load, event(pat, id))) as { lesson: { lateWarning: string } };
		expect(reloaded.lesson.lateWarning).toContain('less than 24 hours');
	});

	it('cancels when the shown warning still matches', async () => {
		const id = await patBooking(5);
		const result = await call(actions.default, event(pat, id, { shownLate: 'true' }));
		expect(isRedirect(result)).toBe(true);
		expect((await ctx.store.getBooking(id))!.status).toBe('cancelled');
	});
});
