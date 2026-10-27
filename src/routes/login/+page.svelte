<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import AuthCard from '#lib/components/AuthCard.svelte';
	import Turnstile from '#lib/components/Turnstile.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let submitting = $state(false);
	let turnstile = $state<ReturnType<typeof Turnstile>>();

	const errors: Partial<Record<string, string>> = $derived(form?.errors ?? {});
	const formError = $derived(form?.error ?? null);
	const locked = $derived(Boolean(form?.locked));
	const email = $derived(form?.email ?? '');

	const submit: SubmitFunction = () => {
		submitting = true;
		return async ({ update }) => {
			await update({ reset: false });
			turnstile?.reset();
			submitting = false;
		};
	};
</script>

<svelte:head>
	<title>Sign in · Brenda Sings</title>
</svelte:head>

<AuthCard title="Sign in">
	<p class="intro">
		Booked a lesson as a guest? <a href="/register">Register</a> with the same email and your lessons
		will be there.
	</p>
	<form method="POST" novalidate use:enhance={submit}>
		{#if formError}
			<p class="error form-error" role="alert">
				{formError}
				{#if locked}
					Too many attempts. Try again in 15 minutes, or
					<a href="/login/reset">reset your password</a>.
				{/if}
			</p>
		{/if}
		<div class="field">
			<label for="email">Email</label>
			<input
				id="email"
				name="email"
				type="email"
				autocomplete="email"
				required
				value={email}
				aria-invalid={errors.email ? 'true' : undefined}
				aria-describedby={errors.email ? 'email-error' : undefined}
			/>
			{#if errors.email}
				<p class="error" id="email-error">{errors.email}</p>
			{/if}
		</div>
		<div class="field">
			<label for="password">Password</label>
			<input
				id="password"
				name="password"
				type="password"
				autocomplete="current-password"
				required
				aria-invalid={errors.password ? 'true' : undefined}
				aria-describedby={errors.password ? 'password-error' : undefined}
			/>
			{#if errors.password}
				<p class="error" id="password-error">{errors.password}</p>
			{/if}
		</div>
		{#if data.turnstileSiteKey}
			<Turnstile sitekey={data.turnstileSiteKey} bind:this={turnstile} />
		{/if}
		<button class="button" type="submit" disabled={submitting}>
			{submitting ? 'Signing in…' : 'Sign in'}
		</button>
	</form>
	<p class="fine-print links">
		<a href="/login/reset">Forgot password?</a>
		<a href="/register">New here? Register</a>
	</p>
</AuthCard>
