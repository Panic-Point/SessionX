<script lang="ts">
	import { page } from '$app/state';

	const token = $derived(page.url.searchParams.get('token'));
</script>

<svelte:head>
	<title>Request sent · SessionX</title>
</svelte:head>

<main>
	<div class="card">
		<div class="check" aria-hidden="true">✓</div>
		<h1>Request sent!</h1>
		<p>Your lesson isn't booked yet. The teacher will review your request.</p>
		<p>You'll get an email when it's approved.</p>
		{#if token}
			<a class="button" href="/manage/{encodeURIComponent(token)}">View your request</a>
			<p class="fine-print">We've also emailed you this link.</p>
		{/if}
		<a class="secondary" href="/book">Book another lesson</a>
	</div>
</main>

<style>
	main {
		max-width: 480px;
		margin: 2rem auto 0;
	}

	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 2rem 1.25rem;
		text-align: center;
	}

	.check {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 3.5rem;
		height: 3.5rem;
		border-radius: 50%;
		background: var(--accent-soft);
		color: var(--accent);
		font-size: 1.75rem;
		font-weight: 700;
	}

	h1 {
		font-size: 1.5rem;
		margin: 0.75rem 0 0.5rem;
	}

	p {
		margin: 0 0 0.5rem;
		color: var(--muted);
	}

	.button {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: var(--tap);
		margin-top: 1.25rem;
		padding: 0.75rem 1.5rem;
		border-radius: 999px;
		background: var(--accent);
		color: #fff;
		font-weight: 600;
		text-decoration: none;
	}

	.button:hover {
		background: var(--accent-hover);
	}

	.fine-print {
		margin-top: 0.5rem;
		font-size: 0.875rem;
	}

	.secondary {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
		margin-top: 0.5rem;
		font-weight: 600;
	}
</style>
