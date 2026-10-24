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

	it('rejects when the send hangs past the timeout', async () => {
		const hanging = ((_url: string | URL | Request, init?: RequestInit) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
			})) as typeof fetch;
		const mailer = createMailer({ EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: 'k' }, hanging, {
			timeoutMs: 20
		});
		await expect(mailer.send(msg)).rejects.toBeDefined();
	});

	it('passes an abort signal to fetch by default', async () => {
		const { fn, calls } = fakeFetch();
		await createMailer({ EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: 'k' }, fn).send(msg);
		expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
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

describe('createMailer outside dev', () => {
	it.each([{}, { EMAIL_TRANSPORT: 'console' }, { EMAIL_TRANSPORT: 'smtp' }])(
		'refuses the console transport for %o when dev is false',
		(env) => {
			expect(() => createMailer(env, fetch, { dev: false })).toThrow(
				'EMAIL_TRANSPORT must be set to resend or mailpit outside dev'
			);
		}
	);
	it('allows the console transport when dev is true', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => {});
		await createMailer({}, fetch, { dev: true }).send(msg);
		expect(info).toHaveBeenCalledOnce();
		info.mockRestore();
	});
	it('allows resend and mailpit when dev is false', () => {
		expect(() =>
			createMailer({ EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: 'k' }, fetch, { dev: false })
		).not.toThrow();
		expect(() =>
			createMailer({ EMAIL_TRANSPORT: 'mailpit', MAILPIT_URL: 'http://m' }, fetch, { dev: false })
		).not.toThrow();
	});
});

describe('createMailer attachments', () => {
	const att = [{ filename: 'lesson.ics', contentType: 'text/calendar', content: 'Zoë' }];
	const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');

	it('resend sends base64 attachment', async () => {
		const { fn, calls } = fakeFetch();
		await createMailer({ EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: 'k' }, fn).send({
			...msg,
			attachments: att
		});
		const body = JSON.parse(calls[0].init.body as string);
		expect(body.attachments).toEqual([{ filename: 'lesson.ics', content: b64('Zoë') }]);
		expect(
			new TextDecoder().decode(
				Uint8Array.from(atob(body.attachments[0].content), (c) => c.charCodeAt(0))
			)
		).toBe('Zoë');
	});
	it('mailpit sends base64 attachment', async () => {
		const { fn, calls } = fakeFetch();
		await createMailer({ EMAIL_TRANSPORT: 'mailpit', MAILPIT_URL: 'http://m' }, fn).send({
			...msg,
			attachments: att
		});
		const body = JSON.parse(calls[0].init.body as string);
		expect(body.Attachments).toEqual([
			{ Filename: 'lesson.ics', ContentType: 'text/calendar', Content: b64('Zoë') }
		]);
	});
	it('omits attachments when none', async () => {
		const { fn, calls } = fakeFetch();
		await createMailer({ EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: 'k' }, fn).send(msg);
		expect(JSON.parse(calls[0].init.body as string)).not.toHaveProperty('attachments');
	});
});
