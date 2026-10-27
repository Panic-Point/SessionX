<script lang="ts">
	import { enhance } from '$app/forms';
	import AuthCard from '#lib/components/AuthCard.svelte';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();

	let submitting = $state(false);
	const error = $derived(form && 'error' in form ? form.error : undefined);
	const email = $derived(form && 'email' in form ? form.email : '');
</script>

<svelte:head>
	<title>Reset password · Brenda Sings</title>
</svelte:head>

<AuthCard title="Reset your password">
	{#if form?.sent}
		<p role="status">
			Check your email — if that address has an account, a link to reset your password is on its
			way. It expires in 30 minutes.
		</p>
		<p class="fine-print"><a href="/login">Back to sign in</a></p>
	{:else}
		<p class="intro">We'll email you a link to choose a new password.</p>
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
				{submitting ? 'Sending…' : 'Email me a reset link'}
			</button>
		</form>
		<p class="fine-print"><a href="/login">Back to sign in</a></p>
	{/if}
</AuthCard>
