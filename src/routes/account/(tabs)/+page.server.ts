import { requireAccount } from '#lib/server/account-guard.ts';
import { getAccountHome } from '#lib/server/account-service.ts';
import { getStore } from '#lib/server/context.ts';
import { parsePeriod, periodQuery } from '#lib/server/periods.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const account = requireAccount(locals.account);
	const store = getStore();
	const now = new Date();
	const { timezone } = await store.getSettings();
	const period = parsePeriod(url.searchParams, timezone, now);
	// Only one of this family's students narrows the list; anything else shows everyone.
	const students = await store.listStudents(account.id);
	const wanted = url.searchParams.get('student');
	const student = students.find((s) => s.id === wanted) ?? null;
	const home = await getAccountHome(
		store,
		account.id,
		now,
		period?.range ?? null,
		student?.id ?? null
	);
	return {
		// Only id and name: student notes are the teacher's.
		students: students.map((s) => ({ id: s.id, name: s.name })),
		student: student && { id: student.id, name: student.name },
		periodParams: periodQuery(url.searchParams),
		upcoming: home.upcoming,
		past: home.past,
		period: period && { ...period, range: undefined },
		// A period that cannot be shown (start after end) lists nothing.
		inPeriod: period?.range ? home.inPeriod : null,
		cancelled: url.searchParams.get('cancelled') === '1'
	};
};
