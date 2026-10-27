<script lang="ts">
	import { enhance } from '$app/forms';
	import AuthCard from '#lib/components/AuthCard.svelte';
	import { PASSWORD_HINT, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '#lib/password-rules.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let submitting = $state(false);
	const invalid = $derived(!data.token || Boolean(form?.invalid));
	const errors: Partial<Record<string, string>> = $derived(form?.errors ?? {});
</script>

<svelte:head>
	<title>Choose a new password · Brenda Sings</title>
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<AuthCard title={invalid ? 'Reset link not valid' : 'Choose a new password'}>
	{#if invalid}
		<p role="alert" class="intro">
			This reset link is invalid, has expired or has already been used.
		</p>
		<a class="button" href="/login/reset">Get a new reset link</a>
	{:else}
		<form
			method="POST"
			novalidate
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
		>
			<input type="hidden" name="token" value={data.token} />
			<div class="field">
				<label for="password">New password</label>
				<input
					id="password"
					name="password"
					type="password"
					autocomplete="new-password"
					required
					minlength={PASSWORD_MIN_LENGTH}
					maxlength={PASSWORD_MAX_LENGTH}
					aria-invalid={errors.password ? 'true' : undefined}
					aria-describedby={errors.password ? 'password-error' : 'password-hint'}
				/>
				{#if errors.password}
					<p class="error" id="password-error">{errors.password}</p>
				{:else}
					<p class="hint" id="password-hint">{PASSWORD_HINT}</p>
				{/if}
			</div>
			<div class="field">
				<label for="confirmPassword">Confirm new password</label>
				<input
					id="confirmPassword"
					name="confirmPassword"
					type="password"
					autocomplete="new-password"
					required
					aria-invalid={errors.confirmPassword ? 'true' : undefined}
					aria-describedby={errors.confirmPassword ? 'confirmPassword-error' : undefined}
				/>
				{#if errors.confirmPassword}
					<p class="error" id="confirmPassword-error">{errors.confirmPassword}</p>
				{/if}
			</div>
			<button class="button" type="submit" disabled={submitting}>
				{submitting ? 'Saving…' : 'Save password and sign in'}
			</button>
		</form>
	{/if}
</AuthCard>
