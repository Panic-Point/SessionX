<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();

	let submitting = $state(false);
	const error = $derived(form && 'error' in form ? form.error : undefined);
	const email = $derived(form && 'email' in form ? form.email : '');
</script>

<svelte:head>
	<title>Sign in · SessionX</title>
</svelte:head>

<main>
	<div class="card">
		<h1>Sign in</h1>
		{#if form?.sent}
			<p role="status">
				Check your email — if that address has an account, a sign-in link is on its way.
			</p>
			<p class="fine-print"><a href="/login">Use a different email</a></p>
		{:else}
			<p class="intro">We'll email you a link to sign in. No password needed.</p>
			<form
				method="POST"
				novalidate
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update({ reset: false });
						submitting = false;
					};
				}}
			>
				<div class="field">
					<label for="email">Email</label>
					<input
						id="email"
						name="email"
						type="email"
						autocomplete="email"
						required
						value={email}
						aria-invalid={error ? 'true' : undefined}
						aria-describedby={error ? 'email-error' : undefined}
					/>
					{#if error}
						<p class="error" id="email-error">{error}</p>
					{/if}
				</div>
				<button class="button" type="submit" disabled={submitting}>
					{submitting ? 'Sending…' : 'Email me a sign-in link'}
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
		margin: 0 0 0.5rem;
	}

	.intro {
		margin: 0 0 1rem;
		color: var(--muted);
	}

	.field {
		margin-bottom: 1rem;
	}

	label {
		display: block;
		font-weight: 600;
		margin-bottom: 0.25rem;
	}

	input {
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

	input[aria-invalid='true'] {
		border-color: var(--danger);
	}

	.error {
		margin: 0.25rem 0 0;
		font-size: 0.875rem;
		color: var(--danger);
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
		cursor: pointer;
	}

	.button:hover {
		background: var(--accent-hover);
	}

	.button:disabled {
		opacity: 0.7;
		cursor: progress;
	}

	.fine-print {
		margin: 0.75rem 0 0;
		font-size: 0.875rem;
	}

	.fine-print a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
	}
</style>
