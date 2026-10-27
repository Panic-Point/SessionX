import { isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { actions as homeActions, load as homeLoad } from './+page.server';
import { actions as cancelActions, load as cancelLoad } from './cancel/[id]/+page.server';

// Defense in depth: every /account load and action enforces the guard itself, because a data
// request can skip layout loads. A signed-out visitor must be redirected before any store access.
const handlers = {
	'load /account': homeLoad,
	'action /account?/addStudent': homeActions.addStudent,
	'action /account?/renameStudent': homeActions.renameStudent,
	'action /account?/password': homeActions.password,
	'load /account/cancel/[id]': cancelLoad,
	'action /account/cancel/[id]': cancelActions.default
} as const;

async function run(name: keyof typeof handlers): Promise<unknown> {
	const event = {
		locals: { account: null },
		params: { id: 'b1' },
		url: new URL('http://localhost/account'),
		request: new Request('http://localhost/account', { method: 'POST', body: new FormData() })
	};
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return await (handlers[name] as any)(event);
	} catch (e) {
		return e;
	}
}

describe('account loads and actions', () => {
	it.each(Object.keys(handlers) as (keyof typeof handlers)[])(
		'%s redirects a signed-out visitor to /login',
		async (name) => {
			const result = await run(name);
			expect(isRedirect(result)).toBe(true);
			expect(result).toMatchObject({ status: 303, location: '/login' });
		}
	);
});
