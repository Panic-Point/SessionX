import { LATE_CANCEL_WARNING, type CancelView } from './account-service';

export interface CancelPageData {
	lessonTypeName: string;
	studentName: string;
	whenLabel: string;
	durationMin: number;
	priceLabel: string;
	statusLabel: string;
	canCancel: boolean;
	/** The late-cancel warning, or null when cancelling now is within policy. */
	lateWarning: string | null;
	policyText: string;
}

/**
 * What both cancel pages (account and manage link) may show. Picks fields explicitly so the
 * account's name and email can never reach a manage-link page.
 */
export function toCancelPageData(view: CancelView): CancelPageData {
	const { booking } = view;
	return {
		lessonTypeName: booking.lessonTypeName,
		studentName: booking.studentName,
		whenLabel: booking.whenLabel,
		durationMin: booking.durationMin,
		priceLabel: booking.priceLabel,
		statusLabel: booking.statusLabel,
		canCancel: booking.canCancel,
		lateWarning: view.late ? LATE_CANCEL_WARNING(view.cutoffHours) : null,
		policyText: view.policyText
	};
}

/**
 * The cancel form's hidden `shownLate` field: whether the page showed the late warning.
 * Anything but `true` (including a missing field) counts as no warning shown, so a request that
 * leaves it out can never cancel late without the family having seen the warning.
 */
export function readShownLate(data: FormData): boolean {
	return data.get('shownLate') === 'true';
}
