import { isActionFailure, isRedirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeCalendar, type FakeCalendar } from '#lib/server/calendar/fake-client.test-helpers.ts';
import type { EmailMessage } from '#lib/server/email/mailer.ts';
import { MemoryBookingStore } from '#lib/server/store/memory.ts';

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

async function submit(token: string, shownLate?: string): Promise<unknown> {
	const body = new FormData();
	if (shownLate !== undefined) body.set('shownLate', shownLate);
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
	ctx.calendar = fakeCalendar(false);
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

	it('treats a missing shownLate as no warning shown, so a late cancel re-renders', async () => {
		const b = await approvedBooking(5);
		const result = await submit(b.token);
		expect(result).toMatchObject({ status: 400, data: { lateChanged: true } });
		expect((await ctx.store.getBooking(b.id))!.status).toBe('approved');
		expect(ctx.sent).toEqual([]);
	});

	it('cancels with a missing shownLate when the lesson is outside the cutoff', async () => {
		const b = await approvedBooking(72);
		expect(isRedirect(await submit(b.token))).toBe(true);
		expect((await ctx.store.getBooking(b.id))!.status).toBe('cancelled');
	});

	it('cancels when the shown warning still matches', async () => {
		const b = await approvedBooking(72);
		expect(isRedirect(await submit(b.token, 'false'))).toBe(true);
		expect((await ctx.store.getBooking(b.id))!.status).toBe('cancelled');
	});
});

describe('/manage/[token]/cancel calendar wiring', () => {
	it('removes the lesson event from the calendar from getCalendar()', async () => {
		ctx.calendar = fakeCalendar();
		await ctx.store.updateSettings({
			...(await ctx.store.getSettings()),
			gcalWriteCalendarId: 'lessons@x.com'
		});
		const b = await approvedBooking(72);
		await ctx.store.setCalendarEventId(b.id, 'evt-9');
		expect(isRedirect(await submit(b.token, 'false'))).toBe(true);
		expect(ctx.calendar.deleted).toEqual([{ calendarId: 'lessons@x.com', eventId: 'evt-9' }]);
	});
});
