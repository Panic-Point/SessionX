import { waitUntil } from 'cloudflare:workers';

/**
 * Keeps work running after the response is sent. On Workers `waitUntil` stops the runtime
 * cancelling it; in dev the adapter's `waitUntil` is a no-op, and Node keeps the promise alive.
 */
export function runInBackground(task: Promise<unknown>): void {
	waitUntil(task.catch((err) => console.error('Background task failed', err)));
}
