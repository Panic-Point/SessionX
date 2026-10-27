import { json } from '@sveltejs/kit';
import { CRON_SECRET } from '$app/env/private';
import { getAppUrl, getCalendar, getStore } from '#lib/server/context.ts';
import { checkCronAuth } from '#lib/server/cron-auth.ts';
import { runScheduledJobs } from '#lib/server/scheduled-jobs.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const auth = await checkCronAuth(request.headers.get('authorization'), CRON_SECRET);
	if (!auth.ok) return json({ ok: false }, { status: auth.status });
	try {
		const deps = { store: getStore(), calendar: getCalendar(), appUrl: getAppUrl() };
		return json({ ok: true, ...(await runScheduledJobs(deps, new Date())) });
	} catch (error) {
		console.error('cron: scheduled jobs failed', error);
		return json({ ok: false }, { status: 500 });
	}
};
