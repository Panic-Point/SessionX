<script lang="ts">
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const links = [
		{ href: '/admin', label: 'Requests' },
		{ href: '/admin/lessons', label: 'Lessons' },
		{ href: '/admin/hours', label: 'Hours' },
		{ href: '/admin/lesson-types', label: 'Lesson types' },
		{ href: '/admin/settings', label: 'Settings' }
	];

	function isCurrent(href: string): boolean {
		const path = page.url.pathname;
		return href === '/admin' ? path === '/admin' : path.startsWith(href);
	}
</script>

<div class="admin">
	<header>
		<p class="who">Signed in as {data.account.email}</p>
		<nav aria-label="Admin">
			<ul>
				{#each links as link (link.href)}
					<li>
						<a href={link.href} aria-current={isCurrent(link.href) ? 'page' : undefined}>
							{link.label}
						</a>
					</li>
				{/each}
				<li>
					<form method="POST" action="/logout">
						<button type="submit">Sign out</button>
					</form>
				</li>
			</ul>
		</nav>
	</header>

	{@render children()}
</div>

<style>
	header {
		margin-bottom: 1rem;
	}

	.who {
		margin: 0 0 0.25rem;
		font-size: 0.875rem;
		color: var(--muted);
		overflow-wrap: anywhere;
	}

	nav ul {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	nav a,
	nav button {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
		padding: 0 0.85rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
		color: var(--text);
		font-family: inherit;
		font-size: 0.95rem;
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
	}

	nav a[aria-current='page'] {
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
	}

	nav button {
		color: var(--accent);
	}

	/* Shared building blocks for the admin pages. */
	.admin :global(h1) {
		font-size: 1.5rem;
		margin: 0.5rem 0 1rem;
	}

	.admin :global(h2) {
		font-size: 1.1rem;
		margin: 0 0 0.75rem;
	}

	.admin :global(.card) {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.25rem;
		margin-bottom: 1rem;
	}

	.admin :global(.banner) {
		padding: 0.75rem 1rem;
		border-radius: var(--radius);
		margin-bottom: 1rem;
		background: var(--accent-soft);
		border: 1px solid #b9d4f1;
	}

	.admin :global(.banner.bad) {
		background: #fdecea;
		border-color: #f3b8b2;
		color: var(--danger);
	}

	.admin :global(.empty) {
		color: var(--muted);
	}

	.admin :global(.field) {
		margin-bottom: 1rem;
	}

	.admin :global(label) {
		display: block;
		font-weight: 600;
		margin-bottom: 0.25rem;
	}

	.admin :global(label.check) {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: var(--tap);
		margin: 0;
	}

	.admin :global(input:not([type='checkbox'])),
	.admin :global(select),
	.admin :global(textarea) {
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

	.admin :global(input[type='checkbox']) {
		width: 1.25rem;
		height: 1.25rem;
		margin: 0;
	}

	.admin :global(textarea) {
		resize: vertical;
	}

	.admin :global([aria-invalid='true']) {
		border-color: var(--danger);
	}

	.admin :global(.hint) {
		margin: 0.25rem 0 0;
		font-size: 0.875rem;
		color: var(--muted);
	}

	.admin :global(.error) {
		margin: 0.25rem 0 0;
		font-size: 0.875rem;
		color: var(--danger);
	}

	.admin :global(.button) {
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
		cursor: pointer;
	}

	.admin :global(.button:hover) {
		background: var(--accent-hover);
	}

	.admin :global(.button.secondary) {
		background: var(--surface);
		color: var(--accent);
	}

	.admin :global(.button.danger) {
		background: var(--surface);
		border-color: var(--danger);
		color: var(--danger);
	}

	.admin :global(.button:disabled) {
		opacity: 0.7;
		cursor: progress;
	}

	.admin :global(.badge) {
		display: inline-block;
		padding: 0.1rem 0.6rem;
		border-radius: 999px;
		background: var(--border);
		color: var(--muted);
		font-size: 0.8rem;
		font-weight: 600;
	}

	.admin :global(.badge.ok) {
		background: #e3f4e8;
		color: #1b6b35;
	}

	.admin :global(.meta) {
		margin: 0.25rem 0 0;
		color: var(--muted);
	}
</style>
