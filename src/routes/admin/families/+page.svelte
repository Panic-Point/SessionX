<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Families · Admin · SessionX</title>
</svelte:head>

<h1>Families</h1>

{#if data.families.length === 0}
	<p class="card empty">No families yet.</p>
{:else}
	<ul class="list">
		{#each data.families as f (f.id)}
			<li class="card">
				<h2><a href="/admin/families/{f.id}">{f.name}</a></h2>
				<p class="meta"><a href="mailto:{f.email}">{f.email}</a></p>
				<p class="meta">
					{f.studentNames.length > 0 ? f.studentNames.join(', ') : 'No students yet'}
				</p>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.list {
		margin: 0;
		padding: 0;
		list-style: none;
	}
</style>
