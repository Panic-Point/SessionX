export interface EmailMessage {
	to: string;
	subject: string;
	text: string;
	html: string;
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
	body: unknown
) {
	const res = await fetchFn(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: JSON.stringify(body)
	});
	if (!res.ok) {
		throw new Error(`Email send failed: ${res.status} ${res.statusText}`.trim());
	}
}

export function createMailer(env: MailerEnv, fetchFn: typeof fetch = fetch): Mailer {
	const from = env.EMAIL_FROM || DEFAULT_FROM;
	switch (env.EMAIL_TRANSPORT) {
		case 'resend':
			return {
				send: (msg) =>
					post(
						fetchFn,
						'https://api.resend.com/emails',
						{ Authorization: `Bearer ${env.RESEND_API_KEY ?? ''}` },
						{ from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }
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
							HTML: msg.html
						}
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
