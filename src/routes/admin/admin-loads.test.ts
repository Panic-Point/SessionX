import { isHttpError, isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import type { Account } from '#lib/server/store/types.ts';
import { load as requestsLoad } from './+page.server';
import { load as hoursLoad } from './hours/+page.server';
import { load as lessonsLoad } from './lessons/+page.server';
import { load as lessonTypesLoad } from './lesson-types/+page.server';
import { load as settingsLoad } from './settings/+page.server';

// Defense in depth: every admin page load must enforce the guard itself, because a data request
// can skip the layout load and a hook bypass would otherwise leak the leaf's data.
const loads = {
	'/admin': requestsLoad,
	'/admin/hours': hoursLoad,
	'/admin/lessons': lessonsLoad,
	'/admin/lesson-types': lessonTypesLoad,
	'/admin/settings': settingsLoad
} as const;

const client: Account = { id: 'c1', name: 'Pat', email: 'pat@example.com', role: 'client' };

async function run(route: keyof typeof loads, account: Account | null): Promise<unknown> {
	const event = { locals: { account }, url: new URL(`http://localhost${route}`) };
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return await (loads[route] as any)(event);
	} catch (e) {
		return e;
	}
}

describe('admin page loads', () => {
	it.each(Object.keys(loads) as (keyof typeof loads)[])(
		'%s redirects a signed-out visitor to /login',
		async (route) => {
			const result = await run(route, null);
			expect(isRedirect(result)).toBe(true);
			expect(result).toMatchObject({ status: 303, location: '/login' });
		}
	);
	it.each(Object.keys(loads) as (keyof typeof loads)[])(
		'%s forbids a signed-in client',
		async (route) => {
			const result = await run(route, client);
			expect(isHttpError(result)).toBe(true);
			expect(result).toMatchObject({ status: 403 });
		}
	);
});
