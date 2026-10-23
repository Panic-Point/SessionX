import type { LayoutServerLoad } from './$types';

// Only the role reaches every page; account details stay inside /admin.
export const load: LayoutServerLoad = ({ locals }) => {
	return { viewer: locals.account?.role ?? null };
};
