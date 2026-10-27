<script lang="ts">
	import logo from '#lib/assets/logo.svg';
</script>

<svelte:head>
	<title>Brenda Sings</title>
</svelte:head>

<main class="landing">
	<h1><img src={logo} alt="Brenda Sings" width="420" height="84" /></h1>
	<p class="tagline">Singing lessons with Brenda White, booked in a minute.</p>
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
		margin: 0 0 0.5rem;
		width: min(100%, 26rem);
	}

	h1 img {
		display: block;
		width: 100%;
		height: auto;
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
