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
	return canSeeCustom ? effectivePriceCents(ctx) : ctx.listPriceCents;
}

/** The price the teacher will charge, snapshotted onto the booking. */
export function effectivePriceCents(ctx: PriceContext): number {
	return ctx.customPriceCents ?? ctx.listPriceCents;
}
