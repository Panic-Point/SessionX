<script lang="ts">
	import { enhance } from '$app/forms';
	import AuthCard from '#lib/components/AuthCard.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let submitting = $state(false);
	const invalid = $derived(!data.token || Boolean(form?.invalid));
</script>

<svelte:head>
	<title>Finish creating your account · SessionX</title>
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<AuthCard title={invalid ? 'Link not valid' : 'Finish creating your account'}>
	{#if invalid}
		<p role="alert" class="intro">This link is invalid, has expired or has already been used.</p>
		<a class="button" href="/register">Register again</a>
	{:else}
		<p class="intro">Confirm your email to turn on your password and sign in.</p>
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
				{submitting ? 'Confirming…' : 'Confirm and sign in'}
			</button>
		</form>
	{/if}
</AuthCard>
