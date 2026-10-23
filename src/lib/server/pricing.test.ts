import { describe, expect, test } from 'vitest';
import { displayPriceCents, effectivePriceCents, type PriceContext } from './pricing';

const withCustom: PriceContext = {
	listPriceCents: 3500,
	studentAccountId: 'A',
	customPriceCents: 3000
};
const noCustom: PriceContext = {
	listPriceCents: 3500,
	studentAccountId: 'A',
	customPriceCents: null
};

describe('displayPriceCents', () => {
	test('guest sees list price even when a custom price exists', () => {
		expect(displayPriceCents({ kind: 'guest' }, withCustom)).toBe(3500);
	});

	test("account sees its own student's custom price", () => {
		expect(displayPriceCents({ kind: 'account', accountId: 'A' }, withCustom)).toBe(3000);
	});

	test('account sees list price when its student has no custom price', () => {
		expect(displayPriceCents({ kind: 'account', accountId: 'A' }, noCustom)).toBe(3500);
	});

	test("account never sees another account's custom price", () => {
		const otherFamily = { ...withCustom, studentAccountId: 'B' };
		expect(displayPriceCents({ kind: 'account', accountId: 'A' }, otherFamily)).toBe(3500);
	});

	test('account sees list price when no student is selected', () => {
		const noStudent = { ...withCustom, studentAccountId: null };
		expect(displayPriceCents({ kind: 'account', accountId: 'A' }, noStudent)).toBe(3500);
	});

	test('admin sees the custom price', () => {
		expect(displayPriceCents({ kind: 'admin' }, withCustom)).toBe(3000);
	});
});

describe('effectivePriceCents', () => {
	test('prefers the custom price', () => {
		expect(effectivePriceCents(withCustom)).toBe(3000);
	});

	test('falls back to the list price', () => {
		expect(effectivePriceCents(noCustom)).toBe(3500);
	});
});
