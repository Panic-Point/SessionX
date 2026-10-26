import { describe, expect, it } from 'vitest';
import { checkCronAuth } from './cron-auth';

const SECRET = 'correct-horse-battery-staple';

describe('checkCronAuth', () => {
	it('returns 503 when the secret is unset', async () => {
		expect(await checkCronAuth(`Bearer ${SECRET}`, undefined)).toEqual({ ok: false, status: 503 });
	});

	it('returns 503 when the secret is empty', async () => {
		expect(await checkCronAuth('Bearer ', '')).toEqual({ ok: false, status: 503 });
	});

	it('returns 401 when the header is missing', async () => {
		expect(await checkCronAuth(null, SECRET)).toEqual({ ok: false, status: 401 });
	});

	it('returns 401 for a wrong secret of the same length', async () => {
		const wrong = 'x'.repeat(SECRET.length);
		expect(await checkCronAuth(`Bearer ${wrong}`, SECRET)).toEqual({ ok: false, status: 401 });
	});

	it('returns 401 for an extra space after Bearer', async () => {
		expect(await checkCronAuth(`Bearer  ${SECRET}`, SECRET)).toEqual({ ok: false, status: 401 });
	});

	it('returns 401 for a different length', async () => {
		expect(await checkCronAuth(`Bearer ${SECRET}x`, SECRET)).toEqual({ ok: false, status: 401 });
	});

	it('accepts the exact Bearer header', async () => {
		expect(await checkCronAuth(`Bearer ${SECRET}`, SECRET)).toEqual({ ok: true });
	});
});
