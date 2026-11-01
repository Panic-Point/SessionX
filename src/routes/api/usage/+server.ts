import { getStore } from '#lib/server/context.ts';
import { beaconEvent, parseBeacon, recordUsage } from '#lib/server/usage.ts';
import type { RequestHandler } from './$types';

/**
 * Page-view beacons from the browser (sendBeacon, text/plain JSON, same origin: SvelteKit's CSRF
 * check rejects other origins). A failed write is logged and still answers 204: nobody sees a
 * beacon's response, and telemetry must never get in a visitor's way.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	let body: unknown = null;
	try {
		body = JSON.parse(await request.text());
	} catch {
		// Falls through to the parse check below.
	}
	const beacon = parseBeacon(body);
	if (!beacon) {
		console.warn('usage: ignored a malformed beacon');
		return new Response(null, { status: 400 });
	}
	const event = beaconEvent(beacon, locals.account, new Date());
	if (event) await recordUsage(getStore(), event);
	return new Response(null, { status: 204 });
};
