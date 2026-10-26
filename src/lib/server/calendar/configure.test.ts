import { describe, expect, it, vi } from 'vitest';
import { configureCalendar } from './configure';

describe('configureCalendar', () => {
	it('is disabled without error when the env var is unset', () => {
		const log = vi.fn();
		const result = configureCalendar({}, log);
		expect(result.client.enabled).toBe(false);
		expect(result.configError).toBeNull();
		expect(log).not.toHaveBeenCalled();
	});

	it('falls back to a disabled client and reports a secret-free error for invalid JSON', async () => {
		const log = vi.fn();
		const raw = '{"client_email":"sa@p.iam.gserviceaccount.com","private_key": SECRETKEY';
		const result = configureCalendar({ GOOGLE_SERVICE_ACCOUNT_JSON: raw }, log);
		expect(result.client.enabled).toBe(false);
		expect(result.client.serviceAccountEmail).toBeNull();
		expect(await result.client.busy(['a@x.com'], new Date(), new Date())).toEqual([]);
		expect(result.configError).toBe('GOOGLE_SERVICE_ACCOUNT_JSON is invalid');
		expect(log).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(log.mock.calls)).not.toContain('SECRETKEY');
	});

	it('is enabled with the service account email for well-formed JSON', () => {
		const raw = JSON.stringify({
			client_email: 'sa@p.iam.gserviceaccount.com',
			private_key: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n'
		});
		const result = configureCalendar({ GOOGLE_SERVICE_ACCOUNT_JSON: raw }, vi.fn());
		expect(result.client.enabled).toBe(true);
		expect(result.client.serviceAccountEmail).toBe('sa@p.iam.gserviceaccount.com');
		expect(result.configError).toBeNull();
	});
});
