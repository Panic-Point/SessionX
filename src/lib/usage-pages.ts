/** A page families or guests can open, as the Usage tab names it. Keyed by SvelteKit route id. */
export interface UsagePage {
	route: string;
	label: string;
	area: 'Booking' | 'Account' | 'Sign-in' | 'Other';
}

/**
 * Every non-admin page. A test checks this matches src/routes, so a new page shows up on the Usage
 * tab (as "not used" until someone opens it) instead of being missed.
 */
export const USAGE_PAGES: readonly UsagePage[] = [
	{ route: '/', label: 'Home', area: 'Other' },
	{ route: '/book', label: 'Book: choose a time', area: 'Booking' },
	{ route: '/book/details', label: 'Book: details', area: 'Booking' },
	{ route: '/book/requested', label: 'Book: request sent', area: 'Booking' },
	{ route: '/manage/[token]', label: 'Booking link from email', area: 'Booking' },
	{ route: '/manage/[token]/cancel', label: 'Cancel from email link', area: 'Booking' },
	{ route: '/account/(tabs)', label: 'My lessons', area: 'Account' },
	{ route: '/account/(tabs)/repertoire', label: 'Repertoire', area: 'Account' },
	{ route: '/account/(tabs)/family', label: 'Manage family', area: 'Account' },
	{ route: '/account/(tabs)/security', label: 'Security', area: 'Account' },
	{ route: '/account/cancel/[id]', label: 'Cancel a lesson', area: 'Account' },
	{ route: '/login', label: 'Sign in', area: 'Sign-in' },
	{ route: '/login/reset', label: 'Forgot password', area: 'Sign-in' },
	{ route: '/login/reset/complete', label: 'Choose a new password', area: 'Sign-in' },
	{ route: '/register', label: 'Create account', area: 'Sign-in' },
	{ route: '/register/verify', label: 'Finish creating account', area: 'Sign-in' },
	{ route: '/offline', label: 'Offline page', area: 'Other' }
];

/** The guest booking steps, in order, for the funnel. */
export const BOOKING_FUNNEL = ['/book', '/book/details', '/book/requested'] as const;

/** Pages that are never tracked: the admin's own use would drown out the families'. */
export function isTrackedRoute(route: string): boolean {
	return !(route === '/admin' || route.startsWith('/admin/') || route.startsWith('/api/'));
}

/** Longest time one beacon may report; longer stretches are almost always an idle tab. */
export const MAX_VIEW_MS = 30 * 60 * 1000;
