import { describe, it, expect, beforeEach } from 'vitest';
import { AccountStoreError } from './types';
import type { AccountStoreErrorCode, AppStore, SongInput } from './types';

const AVA = '33333333-0000-0000-0000-0000000000a1';
const BEN = '33333333-0000-0000-0000-0000000000b1';
const NO_SUCH_STUDENT = '33333333-0000-0000-0000-0000000000ff';
const NO_SUCH_SONG = '55555555-0000-0000-0000-0000000000ff';

function song(overrides: Partial<SongInput> = {}): SongInput {
	return {
		title: 'Edelweiss',
		artist: 'Rodgers & Hammerstein',
		status: 'learning',
		notes: '',
		...overrides
	};
}

async function accountCode(promise: Promise<unknown>): Promise<AccountStoreErrorCode | null> {
	try {
		await promise;
		return null;
	} catch (e) {
		return e instanceof AccountStoreError ? e.code : null;
	}
}

/** Behaviour every RepertoireStore implementation must share. Seeded with supabase/seed.sql data. */
export function runRepertoireStoreContract(
	name: string,
	makeStore: () => Promise<AppStore>,
	reset?: () => Promise<void>
) {
	describe(`RepertoireStore contract: ${name}`, () => {
		if (reset) beforeEach(reset);

		it('starts empty', async () => {
			const store = await makeStore();
			expect(await store.listRepertoire([AVA, BEN])).toEqual([]);
			expect(await store.listRepertoire([])).toEqual([]);
		});

		it('adds songs, trimmed, and lists them by title for the asked students', async () => {
			const store = await makeStore();
			const added = await store.addSong(
				AVA,
				song({ title: ' Moon River ', artist: ' Henry Mancini ', notes: ' Key of C ' })
			);
			expect(added).toMatchObject({
				studentId: AVA,
				title: 'Moon River',
				artist: 'Henry Mancini',
				status: 'learning',
				notes: 'Key of C'
			});
			expect(added.createdAt).toBeInstanceOf(Date);
			await store.addSong(AVA, song({ status: 'ready' }));
			await store.addSong(BEN, song({ title: 'Danny Boy', artist: '', status: 'past' }));

			const ava = await store.listRepertoire([AVA]);
			expect(ava.map((x) => x.title)).toEqual(['Edelweiss', 'Moon River']);
			expect(ava[1]).toEqual(added);
			const both = await store.listRepertoire([AVA, BEN]);
			expect(both.map((x) => x.title)).toEqual(['Danny Boy', 'Edelweiss', 'Moon River']);
		});

		it('rejects a song for an unknown student', async () => {
			const store = await makeStore();
			expect(await accountCode(store.addSong(NO_SUCH_STUDENT, song()))).toBe('not_found');
			expect(await accountCode(store.addSong('not-a-uuid', song()))).toBe('not_found');
		});

		it("updates a student's song", async () => {
			const store = await makeStore();
			const added = await store.addSong(AVA, song());
			const updated = await store.updateSong(
				AVA,
				added.id,
				song({ title: 'Edelweiss ', artist: '', status: 'ready', notes: 'Recital piece' })
			);
			expect(updated).toEqual({
				...added,
				title: 'Edelweiss',
				artist: '',
				status: 'ready',
				notes: 'Recital piece'
			});
			expect(await store.listRepertoire([AVA])).toEqual([updated]);
		});

		it("cannot change or remove another student's song", async () => {
			const store = await makeStore();
			const added = await store.addSong(AVA, song());
			expect(await accountCode(store.updateSong(BEN, added.id, song({ title: 'X' })))).toBe(
				'not_found'
			);
			expect(await accountCode(store.deleteSong(BEN, added.id))).toBe('not_found');
			expect(await accountCode(store.updateSong(AVA, NO_SUCH_SONG, song()))).toBe('not_found');
			expect(await accountCode(store.deleteSong(AVA, 'not-a-uuid'))).toBe('not_found');
			expect(await store.listRepertoire([AVA])).toEqual([added]);
		});

		it('removes a song', async () => {
			const store = await makeStore();
			const keep = await store.addSong(AVA, song({ title: 'Danny Boy' }));
			const drop = await store.addSong(AVA, song());
			await store.deleteSong(AVA, drop.id);
			expect(await store.listRepertoire([AVA])).toEqual([keep]);
			expect(await accountCode(store.deleteSong(AVA, drop.id))).toBe('not_found');
		});
	});
}
