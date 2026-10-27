<script lang="ts">
	import { enhance } from '$app/forms';
	import AuthCard from '#lib/components/AuthCard.svelte';
	import { PASSWORD_HINT, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '#lib/password-rules.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let submitting = $state(false);
	const invalid = $derived(!data.valid || Boolean(form?.invalid));
	const errors: Partial<Record<string, string>> = $derived(form?.errors ?? {});
	const name = $derived(form?.values?.name ?? '');
</script>

<svelte:head>
	<title>Finish creating your account · SessionX</title>
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<AuthCard title={invalid ? 'Link expired' : 'Finish creating your account'}>
	{#if invalid}
		<p role="alert" class="intro">
			This link has expired or has already been used. Register again to get a new one.
		</p>
		<a class="button" href="/register">Register again</a>
	{:else}
		<p class="intro">Choose a password for <strong>{data.email}</strong>.</p>
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
			<!-- Lets password managers file the new password under the right account. -->
			<input type="hidden" name="username" autocomplete="username" value={data.email} />
			{#if data.needsName}
				<div class="field">
					<label for="name">Your name</label>
					<input
						id="name"
						name="name"
						autocomplete="name"
						required
						maxlength="100"
						value={name}
						aria-invalid={errors.name ? 'true' : undefined}
						aria-describedby={errors.name ? 'name-error' : undefined}
					/>
					{#if errors.name}
						<p class="error" id="name-error">{errors.name}</p>
					{/if}
				</div>
			{/if}
			<div class="field">
				<label for="password">Password</label>
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
				<label for="confirmPassword">Confirm password</label>
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
