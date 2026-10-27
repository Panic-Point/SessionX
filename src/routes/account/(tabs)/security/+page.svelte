<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { PASSWORD_HINT, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '#lib/password-rules.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	type Errors = Partial<Record<string, string>>;

	const passwordErrors: Errors = $derived(form?.target === 'password' ? form.errors : {});
	const deleteErrors: Errors = $derived(form?.target === 'delete' ? form.errors : {});

	let busy = $state<string | null>(null);
	// Never keep password values in a form after a submit.
	const track =
		(name: string): SubmitFunction =>
		() => {
			busy = name;
			return async ({ update }) => {
				await update({ reset: true });
				busy = null;
			};
		};

	const lessonsSentence = $derived(
		data.upcomingCount === 0
			? 'You have no upcoming lessons.'
			: data.upcomingCount === 1
				? `Your upcoming lesson will be cancelled. If it starts within ${data.cutoffHours} hours, it counts as a late cancellation under the cancellation policy.`
				: `Your ${data.upcomingCount} upcoming lessons will be cancelled. Any that start within ${data.cutoffHours} hours count as late cancellations under the cancellation policy.`
	);
</script>

<svelte:head>
	<title>Security · Brenda Sings</title>
</svelte:head>

<main>
	<h1>Security</h1>

	{#if form?.message}
		<p class="banner" role="status">{form.message}</p>
	{/if}

	<section class="card" aria-labelledby="password-heading">
		<h2 id="password-heading">Password</h2>
		<p class="empty">
			{data.hasPassword
				? 'Change the password you sign in with.'
				: 'Set a password so you can sign in next time.'}
		</p>
		<form method="POST" action="?/password" novalidate use:enhance={track('password')}>
			<!-- Lets password managers file the new password under the right account. -->
			<input type="hidden" name="username" autocomplete="username" value={data.email} />
			{#if data.hasPassword}
				<div class="field">
					<label for="currentPassword">Current password</label>
					<input
						id="currentPassword"
						name="currentPassword"
						type="password"
						autocomplete="current-password"
						aria-invalid={passwordErrors.currentPassword ? 'true' : undefined}
						aria-describedby={passwordErrors.currentPassword ? 'currentPassword-error' : undefined}
					/>
					{#if passwordErrors.currentPassword}
						<p class="error" id="currentPassword-error">{passwordErrors.currentPassword}</p>
					{/if}
				</div>
			{/if}
			<div class="field">
				<label for="password">{data.hasPassword ? 'New password' : 'Password'}</label>
				<input
					id="password"
					name="password"
					type="password"
					autocomplete="new-password"
					minlength={PASSWORD_MIN_LENGTH}
					maxlength={PASSWORD_MAX_LENGTH}
					aria-invalid={passwordErrors.password ? 'true' : undefined}
					aria-describedby={passwordErrors.password ? 'password-error' : 'password-hint'}
				/>
				{#if passwordErrors.password}
					<p class="error" id="password-error">{passwordErrors.password}</p>
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
					aria-invalid={passwordErrors.confirmPassword ? 'true' : undefined}
					aria-describedby={passwordErrors.confirmPassword ? 'confirmPassword-error' : undefined}
				/>
				{#if passwordErrors.confirmPassword}
					<p class="error" id="confirmPassword-error">{passwordErrors.confirmPassword}</p>
				{/if}
			</div>
			<button class="button" type="submit" disabled={busy === 'password'}>
				{busy === 'password' ? 'Saving…' : data.hasPassword ? 'Change password' : 'Set password'}
			</button>
		</form>
	</section>

	{#if data.canDelete}
		<section class="card" aria-labelledby="delete-heading">
			<h2 id="delete-heading">Delete account</h2>
			<p class="empty">
				Deleting your account signs you out and removes your email and password. {lessonsSentence}
				Brenda keeps a record of your past lessons. You can always book again as a new family.
			</p>
			<details class="confirm" open={form?.target === 'delete' ? true : undefined}>
				<summary>Delete my account…</summary>
				<form method="POST" action="?/deleteAccount" novalidate use:enhance={track('delete')}>
					{#if deleteErrors.form}
						<p class="error" role="alert">{deleteErrors.form}</p>
					{/if}
					{#if data.hasPassword}
						<div class="field">
							<label for="deletePassword">Enter your password to confirm</label>
							<input
								id="deletePassword"
								name="deletePassword"
								type="password"
								autocomplete="current-password"
								aria-invalid={deleteErrors.currentPassword ? 'true' : undefined}
								aria-describedby={deleteErrors.currentPassword ? 'deletePassword-error' : undefined}
							/>
							{#if deleteErrors.currentPassword}
								<p class="error" id="deletePassword-error">{deleteErrors.currentPassword}</p>
							{/if}
						</div>
					{:else}
						<div class="field">
							<label for="confirmEmail">Type your email ({data.email}) to confirm</label>
							<input
								id="confirmEmail"
								name="confirmEmail"
								type="email"
								autocomplete="off"
								aria-invalid={deleteErrors.confirmEmail ? 'true' : undefined}
								aria-describedby={deleteErrors.confirmEmail ? 'confirmEmail-error' : undefined}
							/>
							{#if deleteErrors.confirmEmail}
								<p class="error" id="confirmEmail-error">{deleteErrors.confirmEmail}</p>
							{/if}
						</div>
					{/if}
					<button class="button danger" type="submit" disabled={busy === 'delete'}>
						{busy === 'delete' ? 'Deleting…' : 'Delete my account'}
					</button>
				</form>
			</details>
		</section>
	{/if}
</main>

<style>
	.field {
		margin: 1rem 0;
	}

	.field input {
		width: 100%;
	}

	.confirm {
		margin-top: 1rem;
	}

	.confirm summary {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
		color: var(--danger);
		font-weight: 600;
		cursor: pointer;
	}
</style>
