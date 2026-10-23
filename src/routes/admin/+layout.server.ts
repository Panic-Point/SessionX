import { requireAdmin } from '#lib/server/admin-actions.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	const account = requireAdmin(locals.account);
	return { account: { name: account.name, email: account.email } };
};
