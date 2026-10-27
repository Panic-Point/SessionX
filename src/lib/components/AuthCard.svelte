<script lang="ts">
	import type { Snippet } from 'svelte';

	let { title, children }: { title: string; children: Snippet } = $props();
</script>

<main>
	<div class="card">
		<h1>{title}</h1>
		{@render children()}
	</div>
</main>

<!-- Shared look for the sign-in, registration and password pages. -->
<style>
	main {
		max-width: 480px;
		margin: 2rem auto 0;
	}

	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.25rem;
	}

	h1 {
		font-size: 1.35rem;
		margin: 0 0 0.5rem;
	}

	.card :global(.intro) {
		margin: 0 0 1rem;
		color: var(--muted);
	}

	.card :global(.field) {
		margin-bottom: 1rem;
	}

	.card :global(label) {
		display: block;
		font-weight: 600;
		margin-bottom: 0.25rem;
	}

	.card :global(input:not([type='hidden'])) {
		width: 100%;
		min-height: var(--tap);
		padding: 0.6rem 0.75rem;
		border: 1px solid #c4c9d1;
		border-radius: 8px;
		background: #fff;
		color: var(--text);
		font-family: inherit;
		/* 16px keeps iOS Safari from zooming in on focus. */
		font-size: 1rem;
	}

	.card :global(input[aria-invalid='true']) {
		border-color: var(--danger);
	}

	.card :global(.hint) {
		margin: 0.25rem 0 0;
		font-size: 0.875rem;
		color: var(--muted);
	}

	.card :global(.error) {
		margin: 0.25rem 0 0;
		font-size: 0.875rem;
		color: var(--danger);
	}

	.card :global(.form-error) {
		margin: 0 0 1rem;
	}

	.card :global(.button) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		min-height: var(--tap);
		padding: 0.75rem 1.5rem;
		border: 0;
		border-radius: 999px;
		background: var(--accent);
		color: #fff;
		font-family: inherit;
		font-size: 1rem;
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
	}

	.card :global(.button:hover) {
		background: var(--accent-hover);
	}

	.card :global(.button:disabled) {
		opacity: 0.7;
		cursor: progress;
	}

	.card :global(.fine-print) {
		margin: 0.75rem 0 0;
		font-size: 0.875rem;
	}

	.card :global(.fine-print a) {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
	}

	.card :global(.links) {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0 1rem;
	}
</style>
