<script lang="ts">
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const tabs = [
		{ href: '/account', label: 'Lessons' },
		{ href: '/account/family', label: 'Manage family' },
		{ href: '/account/security', label: 'Security' }
	];
</script>

<div class="account">
	<nav class="tabs" aria-label="My account">
		{#each tabs as tab (tab.href)}
			<a href={tab.href} aria-current={page.url.pathname === tab.href ? 'page' : undefined}>
				{tab.label}
			</a>
		{/each}
	</nav>

	{@render children()}
</div>

<style>
	.account {
		max-width: 720px;
		margin: 0 auto;
	}

	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin-bottom: 1rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--border);
	}

	.tabs a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
		padding: 0 0.85rem;
		border-radius: 999px;
		color: var(--accent);
		font-size: 0.95rem;
		font-weight: 600;
		text-decoration: none;
	}

	.tabs a[aria-current='page'] {
		background: var(--accent-soft);
		color: var(--accent-hover);
	}

	/* Shared building blocks for the account pages. */
	.account :global(h1) {
		font-size: 1.5rem;
		margin: 0 0 1rem;
	}

	.account :global(h2) {
		font-size: 1.1rem;
		margin: 0 0 0.75rem;
	}

	.account :global(.card) {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.25rem;
		margin-bottom: 1rem;
	}

	.account :global(.banner) {
		padding: 0.75rem 1rem;
		border-radius: var(--radius);
		margin: 0 0 1rem;
		background: var(--accent-soft);
		border: 1px solid #b9d4f1;
	}

	.account :global(.empty) {
		margin: 0;
		color: var(--muted);
	}

	.account :global(label) {
		display: block;
		font-weight: 600;
		margin-bottom: 0.25rem;
	}

	.account :global(input:not([type='hidden'])) {
		flex: 1;
		min-width: 0;
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

	.account :global(input[aria-invalid='true']) {
		border-color: var(--danger);
	}

	.account :global(.hint) {
		margin: 0.25rem 0 0;
		font-size: 0.875rem;
		color: var(--muted);
	}

	.account :global(.error) {
		margin: 0.25rem 0 0;
		font-size: 0.875rem;
		color: var(--danger);
	}

	.account :global(.button) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: var(--tap);
		padding: 0.6rem 1.25rem;
		border: 1px solid var(--accent);
		border-radius: 999px;
		background: var(--accent);
		color: #fff;
		font-family: inherit;
		font-size: 1rem;
		font-weight: 600;
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
	}

	.account :global(.button:hover) {
		background: var(--accent-hover);
	}

	.account :global(.button.secondary) {
		background: var(--surface);
		color: var(--accent);
	}

	.account :global(.button.danger) {
		border-color: var(--danger);
		background: var(--danger);
	}

	.account :global(.button.danger:hover) {
		background: #912018;
	}

	.account :global(.button:disabled) {
		opacity: 0.7;
		cursor: progress;
	}

	.account :global(.visually-hidden) {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
