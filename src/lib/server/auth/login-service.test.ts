import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryBookingStore } from '../store/memory';
import { demoData } from '../store/demo-data';
import type { EmailMessage, Mailer } from '../email/mailer';
import { completeLogin, requestLoginLink } from './login-service';

const now = new Date('2026-11-01T00:00:00Z');

function setup(failSend = false) {
	const store = new MemoryBookingStore(demoData());
	const sent: EmailMessage[] = [];
	const mailer: Mailer = {
		send: async (m) => {
			if (failSend) throw new Error('boom');
			sent.push(m);
		}
	};
	return { store, sent, deps: { store, mailer, appUrl: 'https://x.test' } };
}

function tokenFrom(m: EmailMessage): string {
	const match = /https:\/\/x\.test\/admin\/verify\?token=([A-Za-z0-9_-]+)/.exec(m.text);
	return match![1];
}

afterEach(() => vi.restoreAllMocks());

describe('login service', () => {
	it('sends link for known email with 15-minute token', async () => {
		const { deps, sent } = setup();
		await requestLoginLink(deps, '  Admin@SessionX.local ', now);
		expect(sent).toHaveLength(1);
		expect(sent[0].to).toBe('admin@sessionx.local');
		const t = tokenFrom(sent[0]);
		expect(
			await completeLogin(deps.store, t, new Date(now.getTime() + 14 * 60_000))
		).not.toBeNull();
		const s2 = setup();
		await requestLoginLink(s2.deps, 'admin@sessionx.local', now);
		const t2 = tokenFrom(s2.sent[0]);
		expect(await completeLogin(s2.store, t2, new Date(now.getTime() + 15 * 60_000))).toBeNull();
	});
	it('does nothing for unknown email', async () => {
		const { deps, sent } = setup();
		await requestLoginLink(deps, 'nobody@example.com', now);
		expect(sent).toHaveLength(0);
	});
	it('completeLogin returns account once', async () => {
		const { deps, sent } = setup();
		await requestLoginLink(deps, 'admin@sessionx.local', now);
		const acc = await completeLogin(deps.store, tokenFrom(sent[0]), now);
		expect(acc?.email).toBe('admin@sessionx.local');
	});
	it('completeLogin rejects reused token', async () => {
		const { deps, sent } = setup();
		await requestLoginLink(deps, 'admin@sessionx.local', now);
		const t = tokenFrom(sent[0]);
		expect(await completeLogin(deps.store, t, now)).not.toBeNull();
		expect(await completeLogin(deps.store, t, now)).toBeNull();
	});
	it('completeLogin rejects expired token', async () => {
		const { deps, sent } = setup();
		await requestLoginLink(deps, 'admin@sessionx.local', now);
		const later = new Date(now.getTime() + 16 * 60_000);
		expect(await completeLogin(deps.store, tokenFrom(sent[0]), later)).toBeNull();
	});
	it('mailer failure is logged not thrown', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { deps } = setup(true);
		await expect(requestLoginLink(deps, 'admin@sessionx.local', now)).resolves.toBeUndefined();
		expect(spy).toHaveBeenCalled();
	});
});
