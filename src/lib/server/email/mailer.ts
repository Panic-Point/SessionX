export interface EmailMessage {
	to: string;
	subject: string;
	text: string;
	html: string;
	attachments?: { filename: string; contentType: string; content: string }[];
}

/** Base64 of the UTF-8 bytes of `text`. */
function toBase64(text: string): string {
	let bin = '';
	for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
	return btoa(bin);
}

export interface Mailer {
	send(msg: EmailMessage): Promise<void>;
}

export interface MailerEnv {
	EMAIL_TRANSPORT?: string;
	RESEND_API_KEY?: string;
	MAILPIT_URL?: string;
	EMAIL_FROM?: string;
}

const DEFAULT_FROM = 'SessionX <noreply@localhost>';

function parseFrom(from: string): { Email: string; Name: string } {
	const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
	if (m) return { Name: m[1].replace(/^"|"$/g, ''), Email: m[2] };
	return { Name: '', Email: from.trim() };
}

async function post(
	fetchFn: typeof fetch,
	url: string,
	headers: Record<string, string>,
	body: unknown,
	timeoutMs: number
) {
	const res = await fetchFn(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(timeoutMs)
	});
	if (!res.ok) {
		throw new Error(`Email send failed: ${res.status} ${res.statusText}`.trim());
	}
}

export interface MailerOptions {
	/** Abort a send that has not completed after this many milliseconds. Default 5000. */
	timeoutMs?: number;
}

export function createMailer(
	env: MailerEnv,
	fetchFn: typeof fetch = fetch,
	options: MailerOptions = {}
): Mailer {
	const timeoutMs = options.timeoutMs ?? 5000;
	const from = env.EMAIL_FROM || DEFAULT_FROM;
	switch (env.EMAIL_TRANSPORT) {
		case 'resend':
			return {
				send: (msg) =>
					post(
						fetchFn,
						'https://api.resend.com/emails',
						{ Authorization: `Bearer ${env.RESEND_API_KEY ?? ''}` },
						{
							from,
							to: [msg.to],
							subject: msg.subject,
							text: msg.text,
							html: msg.html,
							...(msg.attachments?.length && {
								attachments: msg.attachments.map((a) => ({
									filename: a.filename,
									content: toBase64(a.content)
								}))
							})
						},
						timeoutMs
					)
			};
		case 'mailpit':
			return {
				send: (msg) =>
					post(
						fetchFn,
						`${env.MAILPIT_URL ?? ''}/api/v1/send`,
						{},
						{
							From: parseFrom(from),
							To: [{ Email: msg.to }],
							Subject: msg.subject,
							Text: msg.text,
							HTML: msg.html,
							...(msg.attachments?.length && {
								Attachments: msg.attachments.map((a) => ({
									Filename: a.filename,
									ContentType: a.contentType,
									Content: toBase64(a.content)
								}))
							})
						},
						timeoutMs
					)
			};
		default:
			return {
				send: async (msg) => {
					console.info(`[email] to=${msg.to} subject=${msg.subject}\n${msg.text}`);
				}
			};
	}
}
