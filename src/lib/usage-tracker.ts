import { MAX_VIEW_MS } from './usage-pages';

/** What the browser sends to /api/usage. */
export interface UsageBeacon {
	visitId: string;
	route: string;
	durationMs: number;
	/** True for the first report of a page view; false when it only adds more time to it. */
	newView: boolean;
}

export interface TrackerDeps {
	now: () => number;
	send: (beacon: UsageBeacon) => void;
	visitId: string;
}

/**
 * Times how long each page is visible and reports it when the page changes or the tab is hidden.
 * Hidden time is not counted. Holds no personal data: just the route id and a random visit id.
 */
export function createUsageTracker(deps: TrackerDeps) {
	let route: string | null = null;
	let visibleSince: number | null = null;
	let reported = false;

	function flush() {
		if (route === null) return;
		const ms = visibleSince === null ? 0 : Math.max(0, deps.now() - visibleSince);
		visibleSince = null;
		// An extra report with no new time adds nothing.
		if (reported && ms === 0) return;
		deps.send({
			visitId: deps.visitId,
			route,
			durationMs: Math.min(Math.round(ms), MAX_VIEW_MS),
			newView: !reported
		});
		reported = true;
	}

	return {
		/** Call on every navigation, with the new page's route id (null for an unknown route). */
		navigated(next: string | null) {
			// A query change on the same page (a new month on /book) is still the same view.
			if (next !== null && next === route) return;
			flush();
			route = next;
			reported = false;
			visibleSince = next === null ? null : deps.now();
		},
		hidden() {
			flush();
		},
		visible() {
			if (route !== null && visibleSince === null) visibleSince = deps.now();
		}
	};
}

/**
 * A random id for this tab session, kept in sessionStorage; a fresh one when storage is blocked
 * (reading `sessionStorage` itself can throw, so it is passed as a getter).
 */
export function getVisitId(getStorage: () => Storage | null, random: () => string): string {
	const KEY = 'sx_visit';
	const fresh = random();
	try {
		const storage = getStorage();
		const existing = storage?.getItem(KEY);
		if (existing && /^[\w-]{8,64}$/.test(existing)) return existing;
		storage?.setItem(KEY, fresh);
	} catch {
		// Blocked storage: this page load gets its own visit id.
	}
	return fresh;
}
