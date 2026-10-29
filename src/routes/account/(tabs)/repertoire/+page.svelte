<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Repertoire · Brenda Sings</title>
</svelte:head>

<main>
	<h1>Repertoire</h1>

	{#if data.students.length === 0}
		<p class="card empty">No students yet.</p>
	{/if}

	{#each data.students as student (student.id)}
		<section class="card" aria-labelledby="songs-{student.id}">
			<h2 id="songs-{student.id}">{student.name}</h2>
			{#if student.songs.length === 0}
				<p class="empty">No songs yet. Your teacher adds them as you work on them.</p>
			{:else}
				<ul class="songs">
					{#each student.songs as song (song.id)}
						<li>
							<div class="song">
								<span>
									<strong>{song.title}</strong>
									{#if song.artist}<span class="muted">· {song.artist}</span>{/if}
								</span>
								<span class="status {song.status}">{song.statusLabel}</span>
							</div>
							{#if song.notes}
								<p class="notes">{song.notes}</p>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/each}
</main>

<style>
	.songs {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.songs li {
		padding: 0.6rem 0;
		border-bottom: 1px solid var(--border);
	}

	.songs li:last-child {
		border-bottom: 0;
	}

	.song {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 0.25rem 0.75rem;
	}

	.muted,
	.notes {
		color: var(--muted);
	}

	.notes {
		margin: 0.25rem 0 0;
		font-size: 0.95rem;
		white-space: pre-line;
	}

	.status {
		display: inline-block;
		padding: 0.1rem 0.6rem;
		border-radius: 999px;
		background: var(--border);
		color: var(--muted);
		font-size: 0.8rem;
		font-weight: 600;
	}

	.status.learning {
		background: var(--accent-soft);
		color: var(--accent-hover);
	}

	.status.ready {
		background: #e3f4e8;
		color: #1b6b35;
	}
</style>
