import { describe, expect, it } from 'vitest';
import {
	addSong,
	listFamilyRepertoire,
	removeSong,
	updateSong,
	validateSong,
	type SongForm
} from './repertoire-service';
import { demoData } from './store/demo-data';
import { MemoryBookingStore } from './store/memory';

const PAT = '22222222-0000-0000-0000-00000000000b';
const ADMIN = '22222222-0000-0000-0000-00000000000a';
const AVA = '33333333-0000-0000-0000-0000000000a1';
const BEN = '33333333-0000-0000-0000-0000000000b1';

function form(overrides: Partial<SongForm> = {}): SongForm {
	return { title: 'Edelweiss', artist: '', status: 'learning', notes: '', ...overrides };
}

describe('validateSong', () => {
	it('trims and accepts a song with only a title', () => {
		expect(validateSong(form({ title: ' Edelweiss ', artist: ' ', notes: ' ' }))).toEqual({
			ok: true,
			value: { title: 'Edelweiss', artist: '', status: 'learning', notes: '' }
		});
	});

	it('needs a title and a known status, and limits lengths', () => {
		const result = validateSong(
			form({ title: ' ', artist: 'a'.repeat(201), status: 'sheet', notes: 'n'.repeat(1001) })
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(Object.keys(result.errors).sort()).toEqual(['artist', 'notes', 'status', 'title']);
		}
		expect(validateSong(form({ title: 't'.repeat(201) })).ok).toBe(false);
	});
});

describe('repertoire service', () => {
	it("adds, updates and removes a family student's songs", async () => {
		const store = new MemoryBookingStore(demoData());
		const added = await addSong(store, PAT, AVA, form({ artist: 'Rodgers & Hammerstein' }));
		expect(added.ok).toBe(true);
		if (!added.ok) return;
		const updated = await updateSong(store, PAT, AVA, added.value.id, form({ status: 'ready' }));
		expect(updated).toMatchObject({ ok: true, value: { status: 'ready', artist: '' } });
		expect(await removeSong(store, PAT, AVA, added.value.id)).toEqual({ ok: true, value: null });
		expect(await store.listRepertoire([AVA])).toEqual([]);
	});

	it("refuses a student from another family, and another student's song", async () => {
		const store = new MemoryBookingStore(demoData());
		expect(await addSong(store, ADMIN, AVA, form())).toMatchObject({ ok: false });
		expect(await store.listRepertoire([AVA])).toEqual([]);
		const added = await store.addSong(AVA, {
			title: 'Edelweiss',
			artist: '',
			status: 'learning',
			notes: ''
		});
		expect(await updateSong(store, PAT, BEN, added.id, form())).toMatchObject({
			ok: false,
			errors: { form: 'Song or student not found.' }
		});
		expect(await removeSong(store, ADMIN, AVA, added.id)).toMatchObject({ ok: false });
		expect(await store.listRepertoire([AVA])).toHaveLength(1);
	});

	it('does not save an invalid song', async () => {
		const store = new MemoryBookingStore(demoData());
		expect(await addSong(store, PAT, AVA, form({ title: '' }))).toMatchObject({
			ok: false,
			errors: { title: 'Enter the song title.' }
		});
		expect(await store.listRepertoire([AVA])).toEqual([]);
	});

	it("lists the family's songs learning first, then ready, then past, by title", async () => {
		const store = new MemoryBookingStore(demoData());
		await store.addSong(AVA, { title: 'Ave Maria', artist: '', status: 'past', notes: '' });
		await store.addSong(AVA, { title: 'Moon River', artist: '', status: 'learning', notes: '' });
		await store.addSong(BEN, { title: 'Danny Boy', artist: '', status: 'ready', notes: '' });
		await store.addSong(BEN, { title: 'Edelweiss', artist: '', status: 'learning', notes: '' });
		const other = await store.createAccount('Other', 'other@example.com');
		const zed = await store.addStudent(other.id, 'Zed');
		await store.addSong(zed.id, { title: 'Hidden', artist: '', status: 'learning', notes: '' });

		const songs = await listFamilyRepertoire(store, PAT);
		expect(songs.map((x) => [x.title, x.statusLabel])).toEqual([
			['Edelweiss', 'Learning'],
			['Moon River', 'Learning'],
			['Danny Boy', 'Ready to perform'],
			['Ave Maria', 'Past repertoire']
		]);
		expect(await listFamilyRepertoire(store, 'nobody')).toEqual([]);
	});
});
