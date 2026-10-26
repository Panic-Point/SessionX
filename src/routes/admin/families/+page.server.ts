import { listFamilies } from '#lib/server/admin-service.ts';
import { requireAdmin } from '#lib/server/admin-actions.ts';
import { getStore } from '#lib/server/context.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireAdmin(locals.account);
	return { families: await listFamilies(getStore()) };
};
