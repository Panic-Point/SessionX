<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import logo from '#lib/assets/logo-inline.svg';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	// The admin area has its own navigation; /login doesn't need a link to itself.
	const showLink = $derived(
		!page.url.pathname.startsWith('/admin') && !page.url.pathname.startsWith('/login')
	);
	// The home page shows the full logo itself.
	const showLogo = $derived(page.url.pathname !== '/');
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
</svelte:head>

<div class="app">
	<header class="site-header">
		{#if showLogo}
			<a class="brand" href="/"><img src={logo} alt="Brenda Sings" width="170" height="32" /></a>
		{/if}
		{#if showLink}
			<nav class="account-link" aria-label="Account">
				{#if data.viewer === 'admin'}
					<a href="/admin">Admin</a>
				{:else if data.viewer === 'client'}
					<a href="/account" aria-current={page.url.pathname === '/account' ? 'page' : undefined}
						>My lessons</a
					>
					<form method="POST" action="/logout">
						<button type="submit">Sign out</button>
					</form>
				{:else}
					<a href="/login">Sign in</a>
				{/if}
			</nav>
		{/if}
	</header>
	{@render children()}
</div>

<style>
	:global(:root) {
		/* Brand colours from the Brenda Sings logo (src/lib/assets/logo.svg). */
		--brand: #4a2160;
		--bg: #f8f6f7;
		--surface: #ffffff;
		--text: #1d1a21;
		--muted: #645f6c;
		--border: #e6e1e7;
		--accent: var(--brand);
		--accent-hover: #391850;
		--accent-soft: #f3ecf6;
		--danger: #b42318;
		--radius: 12px;
		--tap: 44px;
		--font:
			system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial,
			sans-serif;
	}

	:global(*, *::before, *::after) {
		box-sizing: border-box;
	}

	:global(body) {
		margin: 0;
		background: var(--bg);
		color: var(--text);
		font-family: var(--font);
		font-size: 1rem;
		line-height: 1.5;
		-webkit-font-smoothing: antialiased;
		-webkit-text-size-adjust: 100%;
	}

	:global(a) {
		color: var(--accent);
	}

	:global(:focus-visible) {
		outline: 3px solid var(--accent);
		outline-offset: 2px;
	}

	:global(h1, h2, h3) {
		line-height: 1.25;
	}

	.app {
		max-width: 960px;
		margin: 0 auto;
		padding: 1rem;
		padding-bottom: calc(1rem + env(safe-area-inset-bottom));
	}

	.site-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		min-height: var(--tap);
		margin-bottom: 0.5rem;
	}

	.brand {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
	}

	.brand img {
		display: block;
		width: auto;
		height: 2rem;
	}

	.account-link {
		display: flex;
		justify-content: flex-end;
		gap: 0.25rem;
		margin-left: auto;
	}

	.account-link a,
	.account-link button {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
		padding: 0 0.5rem;
		border: 0;
		background: none;
		color: var(--accent);
		font-family: inherit;
		font-size: 0.95rem;
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
	}

	@media (min-width: 768px) {
		.app {
			padding: 2rem;
		}

		.brand img {
			height: 2.5rem;
		}
	}
</style>
