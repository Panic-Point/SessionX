import type { Result } from './admin-validation';
import {
	AccountStoreError,
	type AppStore,
	type RepertoireSong,
	type SongInput,
	type SongStatus
} from './store/types';

const MAX_TITLE = 200;
const MAX_ARTIST = 200;
const MAX_NOTES = 1000;

/** In the order songs are listed. */
export const SONG_STATUSES: SongStatus[] = ['learning', 'ready', 'past'];

export const SONG_STATUS_LABELS: Record<SongStatus, string> = {
	learning: 'Learning',
	ready: 'Ready to perform',
	past: 'Past repertoire'
};

export const SONG_FORM_FIELDS = ['title', 'artist', 'status', 'notes'] as const;
export type SongForm = Record<(typeof SONG_FORM_FIELDS)[number], string>;

export interface SongView {
	id: string;
	studentId: string;
	title: string;
	artist: string;
	status: SongStatus;
	statusLabel: string;
	notes: string;
}

export function validateSong(form: SongForm): Result<SongInput> {
	const title = form.title.trim();
	const artist = form.artist.trim();
	const notes = form.notes.trim();
	const errors: Record<string, string> = {};
	if (!title) errors.title = 'Enter the song title.';
	else if (title.length > MAX_TITLE) errors.title = `Keep the title under ${MAX_TITLE} characters.`;
	if (artist.length > MAX_ARTIST) {
		errors.artist = `Keep the composer or artist under ${MAX_ARTIST} characters.`;
	}
	if (!SONG_STATUSES.includes(form.status as SongStatus)) errors.status = 'Choose a status.';
	if (notes.length > MAX_NOTES) errors.notes = `Keep notes under ${MAX_NOTES} characters.`;
	if (Object.keys(errors).length > 0) return { ok: false, errors };
	return { ok: true, value: { title, artist, status: form.status as SongStatus, notes } };
}

/** Learning first, then ready, then past; by title within each. */
export function toSongViews(songs: RepertoireSong[]): SongView[] {
	return songs
		.map((x) => ({
			id: x.id,
			studentId: x.studentId,
			title: x.title,
			artist: x.artist,
			status: x.status,
			statusLabel: SONG_STATUS_LABELS[x.status],
			notes: x.notes
		}))
		.sort(
			(a, b) =>
				SONG_STATUSES.indexOf(a.status) - SONG_STATUSES.indexOf(b.status) ||
				a.title.localeCompare(b.title)
		);
}

/** Every song of the account's students; an unknown account has none. */
export async function listFamilyRepertoire(
	store: AppStore,
	accountId: string
): Promise<SongView[]> {
	const students = await store.listStudents(accountId);
	if (students.length === 0) return [];
	return toSongViews(await store.listRepertoire(students.map((s) => s.id)));
}

const NOT_FOUND = { ok: false, errors: { form: 'Song or student not found.' } } as const;

/** The student must be one of the family's; admin forms post the ids. */
async function inFamily(store: AppStore, accountId: string, studentId: string): Promise<boolean> {
	const students = await store.listStudents(accountId);
	return students.some((s) => s.id === studentId);
}

async function guard<T>(run: () => Promise<T>): Promise<Result<T>> {
	try {
		return { ok: true, value: await run() };
	} catch (e) {
		if (e instanceof AccountStoreError && e.code === 'not_found') return NOT_FOUND;
		throw e;
	}
}

export async function addSong(
	store: AppStore,
	accountId: string,
	studentId: string,
	form: SongForm
): Promise<Result<RepertoireSong>> {
	const valid = validateSong(form);
	if (!valid.ok) return valid;
	if (!(await inFamily(store, accountId, studentId))) return NOT_FOUND;
	return guard(() => store.addSong(studentId, valid.value));
}

export async function updateSong(
	store: AppStore,
	accountId: string,
	studentId: string,
	songId: string,
	form: SongForm
): Promise<Result<RepertoireSong>> {
	const valid = validateSong(form);
	if (!valid.ok) return valid;
	if (!(await inFamily(store, accountId, studentId))) return NOT_FOUND;
	return guard(() => store.updateSong(studentId, songId, valid.value));
}

export async function removeSong(
	store: AppStore,
	accountId: string,
	studentId: string,
	songId: string
): Promise<Result<null>> {
	if (!(await inFamily(store, accountId, studentId))) return NOT_FOUND;
	return guard(async () => {
		await store.deleteSong(studentId, songId);
		return null;
	});
}
