/** Who is looking at a price. */
export type Viewer = { kind: 'guest' } | { kind: 'account'; accountId: string } | { kind: 'admin' };

export interface PriceContext {
	listPriceCents: number;
	/** Account that owns the student the price is for; null when no student is chosen. */
	studentAccountId: string | null;
	/** The student's custom price for this lesson type, if the admin set one. */
	customPriceCents: number | null;
}

/**
 * The price to show this viewer. Custom prices are visible only to the admin and to the
 * signed-in account that owns the student; everyone else sees the list price.
 */
export function displayPriceCents(viewer: Viewer, ctx: PriceContext): number {
	const canSeeCustom =
		viewer.kind === 'admin' ||
		(viewer.kind === 'account' && viewer.accountId === ctx.studentAccountId);
	return canSeeCustom ? (ctx.customPriceCents ?? ctx.listPriceCents) : ctx.listPriceCents;
}

/**
 * The price snapshotted onto a booking: whatever the booker was shown. A guest booking for a
 * student with a custom price is charged the list price, so a custom price never leaks to
 * (or surprises) someone who isn't signed in as that student's account.
 */
export function snapshotPriceCents(booker: Viewer, ctx: PriceContext): number {
	return displayPriceCents(booker, ctx);
}
