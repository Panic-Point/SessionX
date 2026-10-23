<svelte:head>
	<title>SessionX</title>
</svelte:head>

<main class="landing">
	<h1>SessionX</h1>
	<p class="tagline">Private lessons, booked in a minute.</p>
	<a class="cta" href="/book">Book a lesson</a>
</main>

<style>
	.landing {
		min-height: 70vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		gap: 0.5rem;
	}

	h1 {
		font-size: 2.25rem;
		margin: 0;
	}

	.tagline {
		color: var(--muted);
		margin: 0 0 1.5rem;
	}

	.cta {
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

	.cta:hover {
		background: var(--accent-hover);
	}
</style>
