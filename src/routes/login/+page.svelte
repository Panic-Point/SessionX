<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import AuthCard from '#lib/components/AuthCard.svelte';
	import Turnstile from '#lib/components/Turnstile.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let submitting = $state(false);
	let turnstile = $state<ReturnType<typeof Turnstile>>();

	const linkMode = $derived(form ? form.mode === 'link' : data.linkMode);
	const sent = $derived(Boolean(form?.sent));
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
	<title>Sign in · SessionX</title>
</svelte:head>

<AuthCard title="Sign in">
	{#if sent}
		<p role="status">
			Check your email — if that address has an account, a sign-in link is on its way.
		</p>
		<p class="fine-print"><a href="/login?link">Use a different email</a></p>
	{:else if linkMode}
		<p class="intro">We'll email you a link to sign in. No password needed.</p>
		<form method="POST" action="?/link" novalidate use:enhance={submit}>
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
			<button class="button" type="submit" disabled={submitting}>
				{submitting ? 'Sending…' : 'Email me a sign-in link'}
			</button>
		</form>
		<p class="fine-print"><a href="/login">Sign in with a password instead</a></p>
	{:else}
		<form method="POST" action="?/password" novalidate use:enhance={submit}>
			{#if formError}
				<p class="error form-error" role="alert">
					{formError}
					{#if locked}
						Too many attempts. Try again in 15 minutes, or <a href="/login?link"
							>use an email sign-in link</a
						>.
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
		<p class="fine-print"><a href="/login?link">Email me a sign-in link instead</a></p>
		<p class="fine-print links">
			<a href="/login/reset">Forgot password?</a>
			<a href="/register">New here? Register</a>
		</p>
	{/if}
</AuthCard>
