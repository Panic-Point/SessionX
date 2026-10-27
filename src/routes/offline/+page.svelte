<script lang="ts">
	// The service worker serves this page in place of whatever page failed to load, so
	// "Try again" reloads the current address. Without JS the link just goes home.
	function tryAgain(event: MouseEvent) {
		if (location.pathname === '/offline') return;
		event.preventDefault();
		location.reload();
	}
</script>

<svelte:head>
	<title>You're offline · Brenda Sings</title>
</svelte:head>

<main class="offline">
	<h1>You're offline</h1>
	<p>Brenda Sings needs a connection to show lessons and bookings. Check your signal or Wi-Fi.</p>
	<a class="retry" href="/" data-sveltekit-reload onclick={tryAgain}>Try again</a>
</main>

<style>
	.offline {
		min-height: 70vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		gap: 0.5rem;
	}

	h1 {
		margin: 0;
	}

	p {
		color: var(--muted);
		max-width: 32ch;
		margin: 0 0 1.5rem;
	}

	.retry {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: var(--tap);
		padding: 0.75rem 1.75rem;
		border-radius: 999px;
		background: var(--accent);
		color: #fff;
		font-weight: 600;
		text-decoration: none;
	}

	.retry:hover {
		background: var(--accent-hover);
	}
</style>
