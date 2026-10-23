<script lang="ts">
	interface Props {
		/** Heading for the list, e.g. "Monday, November 2". */
		heading: string;
		times: { iso: string; label: string }[];
		timeHref: (iso: string) => string;
	}

	let { heading, times, timeHref }: Props = $props();
</script>

<section class="times" aria-labelledby="times-heading">
	<h2 id="times-heading">{heading}</h2>
	{#if times.length === 0}
		<p class="empty">No times available on this day.</p>
	{:else}
		<ul>
			{#each times as time (time.iso)}
				<li><a class="time" href={timeHref(time.iso)}>{time.label}</a></li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	h2 {
		font-size: 1.05rem;
		font-weight: 600;
		margin: 0 0 0.75rem;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
		gap: 0.5rem;
	}

	.time {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: var(--tap);
		padding: 0.5rem;
		border: 1px solid var(--accent);
		border-radius: 8px;
		color: var(--accent);
		font-weight: 600;
		text-decoration: none;
		font-variant-numeric: tabular-nums;
	}

	.time:hover {
		background: var(--accent);
		color: #fff;
	}

	.empty {
		color: var(--muted);
	}
</style>
