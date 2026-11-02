import { isTrackedRoute, MAX_VIEW_MS } from '../usage-pages';
import type { UsageBeacon } from '../usage-tracker';
import type { Account, UsageEventInput, UsageStore } from './store/types';

const ROUTE = /^\/[\w\-/[\]().]{0,119}$/;
const VISIT = /^[\w-]{8,64}$/;

/** Parses a /api/usage body; null when it is not a well-formed beacon. */
export function parseBeacon(body: unknown): UsageBeacon | null {
	if (typeof body !== 'object' || body === null) return null;
	const { visitId, route, durationMs, newView } = body as Record<string, unknown>;
	if (typeof visitId !== 'string' || !VISIT.test(visitId)) return null;
	if (typeof route !== 'string' || !ROUTE.test(route)) return null;
	if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return null;
	if (typeof newView !== 'boolean') return null;
	return { visitId, route, durationMs: Math.min(Math.round(durationMs), MAX_VIEW_MS), newView };
}

/** The event to store for a beacon; null when it should not be recorded (admins, admin pages). */
export function beaconEvent(
	beacon: UsageBeacon,
	account: Account | null,
	now: Date
): UsageEventInput | null {
	if (account?.role === 'admin' || !isTrackedRoute(beacon.route)) return null;
	return {
		kind: beacon.newView ? 'page_view' : 'page_time',
		occurredAt: now,
		accountId: account?.id ?? null,
		visitId: beacon.visitId,
		route: beacon.route,
		durationMs: beacon.durationMs,
		detail: null
	};
}

/**
 * Records a usage event. Telemetry must never break the page it measures, so a failure is logged
 * (it shows in the Cloudflare logs) and the Usage tab's "last recorded" line goes stale, but the
 * caller carries on.
 */
export async function recordUsage(store: UsageStore, event: UsageEventInput): Promise<boolean> {
	try {
		await store.recordUsageEvent(event);
		return true;
	} catch (error) {
		console.error(`usage: failed to record ${event.kind} event`, error);
		return false;
	}
}

/** A sign-in by a family; the admin's own sign-ins are not counted. */
export function signInEvent(account: Account, now: Date): UsageEventInput | null {
	if (account.role === 'admin') return null;
	return {
		kind: 'sign_in',
		occurredAt: now,
		accountId: account.id,
		visitId: null,
		route: null,
		durationMs: null,
		detail: null
	};
}

/** A wrong email or password. Who tried is not stored. */
export function signInFailedEvent(now: Date): UsageEventInput {
	return {
		kind: 'sign_in_failed',
		occurredAt: now,
		accountId: null,
		visitId: null,
		route: '/login',
		durationMs: null,
		detail: null
	};
}

/** A server error on a page or action. `detail` is the status and a short message, never a URL. */
export function errorEvent(
	routeId: string | null,
	status: number,
	message: string,
	account: Account | null,
	now: Date
): UsageEventInput {
	return {
		kind: 'error',
		occurredAt: now,
		accountId: account?.role === 'client' ? account.id : null,
		visitId: null,
		route: routeId,
		durationMs: null,
		detail: `${status} ${message}`.slice(0, 200)
	};
}
