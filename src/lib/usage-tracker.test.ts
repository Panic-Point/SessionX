import { describe, expect, it } from 'vitest';
import { MAX_VIEW_MS } from './usage-pages';
import { createUsageTracker, getVisitId, type UsageBeacon } from './usage-tracker';

function setup() {
	let t = 0;
	const sent: UsageBeacon[] = [];
	const tracker = createUsageTracker({
		now: () => t,
		send: (b) => sent.push(b),
		visitId: 'visit-12345678'
	});
	return { tracker, sent, advance: (ms: number) => (t += ms) };
}

describe('createUsageTracker', () => {
	it('reports the time on each page when the visitor moves on', () => {
		const { tracker, sent, advance } = setup();
		tracker.navigated('/book');
		advance(5000);
		tracker.navigated('/book/details');
		advance(2000);
		tracker.hidden();
		expect(sent).toEqual([
			{ visitId: 'visit-12345678', route: '/book', durationMs: 5000, newView: true },
			{ visitId: 'visit-12345678', route: '/book/details', durationMs: 2000, newView: true }
		]);
	});

	it('does not count hidden time, and adds time after the tab comes back to the same view', () => {
		const { tracker, sent, advance } = setup();
		tracker.navigated('/account/(tabs)');
		advance(1000);
		tracker.hidden();
		advance(60_000);
		tracker.hidden();
		tracker.visible();
		advance(3000);
		tracker.navigated('/');
		expect(sent.map((b) => [b.route, b.durationMs, b.newView])).toEqual([
			['/account/(tabs)', 1000, true],
			['/account/(tabs)', 3000, false]
		]);
	});

	it('keeps one view when only the query changes', () => {
		const { tracker, sent, advance } = setup();
		tracker.navigated('/book');
		advance(1000);
		tracker.navigated('/book');
		advance(1000);
		tracker.navigated('/login');
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({ route: '/book', durationMs: 2000 });
	});

	it('sends nothing for untracked pages and caps idle tabs', () => {
		const { tracker, sent, advance } = setup();
		tracker.navigated(null);
		advance(5000);
		tracker.hidden();
		expect(sent).toEqual([]);
		tracker.navigated('/');
		advance(MAX_VIEW_MS * 3);
		tracker.hidden();
		expect(sent[0].durationMs).toBe(MAX_VIEW_MS);
	});
});

describe('getVisitId', () => {
	function memoryStorage(): Storage {
		const m = new Map<string, string>();
		return {
			getItem: (k: string) => m.get(k) ?? null,
			setItem: (k: string, v: string) => void m.set(k, v)
		} as Storage;
	}

	it('keeps one id per tab session', () => {
		const storage = memoryStorage();
		let n = 0;
		const random = () => `random-id-${n++}`;
		expect(getVisitId(() => storage, random)).toBe('random-id-0');
		expect(getVisitId(() => storage, random)).toBe('random-id-0');
	});

	it('still works when storage is blocked', () => {
		const blocked = () => {
			throw new DOMException('blocked', 'SecurityError');
		};
		expect(getVisitId(blocked, () => 'random-id-x')).toBe('random-id-x');
	});
});
