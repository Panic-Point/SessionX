import { requireAccount } from '#lib/server/account-guard.ts';
import { getStore } from '#lib/server/context.ts';
import { toSongViews } from '#lib/server/repertoire-service.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const account = requireAccount(locals.account);
	const store = getStore();
	const students = await store.listStudents(account.id);
	const songs =
		students.length === 0 ? [] : toSongViews(await store.listRepertoire(students.map((s) => s.id)));
	// Read-only: the teacher keeps the list.
	return {
		students: students.map((s) => ({
			id: s.id,
			name: s.name,
			songs: songs
				.filter((x) => x.studentId === s.id)
				.map((x) => ({
					id: x.id,
					title: x.title,
					artist: x.artist,
					status: x.status,
					statusLabel: x.statusLabel,
					notes: x.notes
				}))
		}))
	};
};
