<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let submitting = $state(false);
	const invalid = $derived(!data.token || Boolean(form?.invalid));
</script>

<svelte:head>
	<title>Sign in · SessionX</title>
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<main>
	<div class="card">
		{#if invalid}
			<h1>Sign-in link not valid</h1>
			<p role="alert">This sign-in link is invalid or has expired.</p>
			<a class="button" href="/login">Get a new sign-in link</a>
		{:else}
			<h1>Sign in to SessionX</h1>
			<form
				method="POST"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update();
						submitting = false;
					};
				}}
			>
				<input type="hidden" name="token" value={data.token} />
				<button class="button" type="submit" disabled={submitting}>
					{submitting ? 'Signing in…' : 'Sign in to SessionX'}
				</button>
			</form>
		{/if}
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
		padding: 1.25rem;
	}

	h1 {
		font-size: 1.35rem;
		margin: 0 0 1rem;
	}

	p {
		margin: 0 0 1rem;
	}

	.button {
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

	.button:hover {
		background: var(--accent-hover);
	}

	.button:disabled {
		opacity: 0.7;
		cursor: progress;
	}
</style>
