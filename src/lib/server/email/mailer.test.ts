import { describe, expect, it, vi } from 'vitest';
import { createMailer } from './mailer';

const msg = { to: 'a@b.com', subject: 'S', text: 'T', html: '<p>T</p>' };

function fakeFetch(status = 200) {
	const calls: { url: string; init: RequestInit }[] = [];
	const fn = (async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(url), init: init ?? {} });
		return new Response('', { status });
	}) as typeof fetch;
	return { fn, calls };
}

describe('createMailer', () => {
	it('resend transport posts expected request', async () => {
		const { fn, calls } = fakeFetch();
		await createMailer(
			{ EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: 'k', EMAIL_FROM: 'X <x@y.com>' },
			fn
		).send(msg);
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe('https://api.resend.com/emails');
		expect(calls[0].init.method).toBe('POST');
		expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer k');
		expect(JSON.parse(calls[0].init.body as string)).toEqual({
			from: 'X <x@y.com>',
			to: ['a@b.com'],
			subject: 'S',
			text: 'T',
			html: '<p>T</p>'
		});
	});

	it('mailpit transport posts expected request', async () => {
		const { fn, calls } = fakeFetch();
		await createMailer(
			{
				EMAIL_TRANSPORT: 'mailpit',
				MAILPIT_URL: 'http://localhost:8025',
				EMAIL_FROM: 'X <x@y.com>'
			},
			fn
		).send(msg);
		expect(calls[0].url).toBe('http://localhost:8025/api/v1/send');
		expect(JSON.parse(calls[0].init.body as string)).toEqual({
			From: { Email: 'x@y.com', Name: 'X' },
			To: [{ Email: 'a@b.com' }],
			Subject: 'S',
			Text: 'T',
			HTML: '<p>T</p>'
		});
	});

	it('non-2xx response throws', async () => {
		const { fn } = fakeFetch(500);
		await expect(
			createMailer({ EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: 'k' }, fn).send(msg)
		).rejects.toThrow(/500/);
	});

	it('defaults to console transport', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => {});
		const { fn, calls } = fakeFetch();
		await createMailer({}, fn).send(msg);
		expect(info).toHaveBeenCalledTimes(1);
		expect(calls).toHaveLength(0);
		info.mockRestore();
	});
});
