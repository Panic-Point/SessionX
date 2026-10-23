<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	// The admin area has its own navigation; /login doesn't need a link to itself.
	const showLink = $derived(
		!page.url.pathname.startsWith('/admin') && !page.url.pathname.startsWith('/login')
	);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
	<meta name="theme-color" content="#f6f7f9" />
</svelte:head>

<div class="app">
	{#if showLink}
		<nav class="account-link" aria-label="Account">
			{#if data.viewer === 'admin'}
				<a href="/admin">Admin</a>
			{:else if data.viewer === 'client'}
				<form method="POST" action="/logout">
					<button type="submit">Sign out</button>
				</form>
			{:else}
				<a href="/login">Sign in</a>
			{/if}
		</nav>
	{/if}
	{@render children()}
</div>

<style>
	:global(:root) {
		--bg: #f6f7f9;
		--surface: #ffffff;
		--text: #1a1d23;
		--muted: #5f6672;
		--border: #e2e5ea;
		--accent: #0b6bcb;
		--accent-hover: #0957a6;
		--accent-soft: #e6f0fb;
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

	.account-link {
		display: flex;
		justify-content: flex-end;
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
	}
</style>
