import { isActionFailure, isRedirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessage } from '#lib/server/email/mailer.ts';
import { MemoryBookingStore } from '#lib/server/store/memory.ts';
import type { Account } from '#lib/server/store/types.ts';

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

const LESSON_30 = '11111111-0000-0000-0000-000000000030';
const AVA = '33333333-0000-0000-0000-0000000000a1';
const pat: Account = {
	id: '22222222-0000-0000-0000-00000000000b',
	name: 'Pat Parent',
	email: 'parent@example.com',
	role: 'client'
};
const LIMIT =
	'You already have 2 lesson requests waiting for approval. Please wait for a reply before requesting more.';

/** A bookable weekday slot at least 3 days out, from 21:00 UTC (late afternoon in New York). */
function slot(offsetMin: number): string {
	const d = new Date();
	d.setUTCDate(d.getUTCDate() + 3);
	while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
	d.setUTCHours(21, offsetMin, 0, 0);
	return d.toISOString();
}

async function submit(startsAt: string): Promise<unknown> {
	const body = new FormData();
	body.set('lessonTypeId', LESSON_30);
	body.set('startsAt', startsAt);
	body.set('studentId', AVA);
	body.set('note', '');
	const event = {
		locals: { account: pat },
		request: new Request('http://localhost/book/details', { method: 'POST', body })
	};
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return await (actions.default as any)(event);
	} catch (e) {
		return e;
	}
}

describe('/book/details action, signed in', () => {
	beforeEach(() => {
		ctx.store = new MemoryBookingStore();
		ctx.sent = [];
	});

	it('reports the pending-request limit as a form error, not as an unavailable time', async () => {
		expect(isRedirect(await submit(slot(0)))).toBe(true);
		expect(isRedirect(await submit(slot(30)))).toBe(true);
		const result = await submit(slot(60));
		expect(isActionFailure(result)).toBe(true);
		const data = (result as { data: { errors: Record<string, string> } }).data;
		expect(data.errors).toEqual({ form: LIMIT });
		expect(data.errors.startsAt).toBeUndefined();
	});
});
