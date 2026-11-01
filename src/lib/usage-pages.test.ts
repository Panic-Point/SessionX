import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOOKING_FUNNEL, isTrackedRoute, USAGE_PAGES } from './usage-pages';

function pageRoutes(dir: string, route = ''): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory())
			out.push(...pageRoutes(join(dir, entry.name), `${route}/${entry.name}`));
		else if (entry.name === '+page.svelte') out.push(route || '/');
	}
	return out;
}

describe('USAGE_PAGES', () => {
	it('lists every page families and guests can open, so unused ones show as unused', () => {
		const routes = pageRoutes(join(import.meta.dirname, '../routes')).filter(isTrackedRoute);
		expect([...USAGE_PAGES.map((p) => p.route)].sort()).toEqual(routes.sort());
	});

	it('has the booking funnel steps', () => {
		for (const step of BOOKING_FUNNEL) {
			expect(USAGE_PAGES.some((p) => p.route === step)).toBe(true);
		}
	});

	it('never tracks admin pages or the API', () => {
		expect(isTrackedRoute('/admin')).toBe(false);
		expect(isTrackedRoute('/admin/usage')).toBe(false);
		expect(isTrackedRoute('/api/usage')).toBe(false);
		expect(isTrackedRoute('/administer')).toBe(true);
	});
});
