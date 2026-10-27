<script lang="ts">
	import { enhance } from '$app/forms';
	import AuthCard from '#lib/components/AuthCard.svelte';
	import Turnstile from '#lib/components/Turnstile.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let submitting = $state(false);
	let turnstile = $state<ReturnType<typeof Turnstile>>();

	const values = $derived(form?.values ?? { email: data.email });
	const errors: Partial<Record<string, string>> = $derived(form?.errors ?? {});
</script>

<svelte:head>
	<title>Register · SessionX</title>
</svelte:head>

<AuthCard title={form?.sent ? 'Check your email' : 'Register'}>
	{#if form?.sent}
		<p role="status">
			Check your email to finish creating your account. The link expires in 24 hours.
		</p>
		<p class="fine-print"><a href="/login">Back to sign in</a></p>
	{:else}
		<p class="intro">
			Create an account to book and manage lessons. Enter your email and we'll send you a link to
			choose your password. Already booked as a guest? Use the same email and your lessons will be
			there.
		</p>
		<form
			method="POST"
			novalidate
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update({ reset: false });
					turnstile?.reset();
					submitting = false;
				};
			}}
		>
			{#if errors.form}
				<p class="error form-error" role="alert">{errors.form}</p>
			{/if}
			<div class="field">
				<label for="email">Email</label>
				<input
					id="email"
					name="email"
					type="email"
					autocomplete="email"
					required
					value={values.email}
					aria-invalid={errors.email ? 'true' : undefined}
					aria-describedby={errors.email ? 'email-error' : undefined}
				/>
				{#if errors.email}
					<p class="error" id="email-error">{errors.email}</p>
				{/if}
			</div>
			{#if data.turnstileSiteKey}
				<Turnstile sitekey={data.turnstileSiteKey} bind:this={turnstile} />
			{/if}
			<button class="button" type="submit" disabled={submitting}>
				{submitting ? 'Sending…' : 'Send link'}
			</button>
		</form>
		<p class="fine-print">Already have an account? <a href="/login">Sign in</a></p>
	{/if}
</AuthCard>
