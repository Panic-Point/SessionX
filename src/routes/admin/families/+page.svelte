<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const errors = $derived<Record<string, string>>(form?.errors ?? {});
	const values = $derived(form?.values ?? { name: '', email: '', studentName: '', invite: true });
</script>

<svelte:head>
	<title>Families · Admin · Brenda Sings</title>
</svelte:head>

<h1>Families</h1>

<section class="card">
	<details open={form !== null && form !== undefined}>
		<summary>Add a family</summary>
		<p class="hint">
			For a family who hasn't booked online yet. You can then add students and book lessons for
			them.
		</p>
		{#if errors.form}
			<p class="banner bad" role="alert">{errors.form}</p>
		{/if}
		<form method="POST" action="?/create" novalidate use:enhance>
			{@render field('family-name', 'name', "Parent's name", values.name, 'text', 'name')}
			{@render field('family-email', 'email', 'Email', values.email, 'email', 'email')}
			{@render field(
				'family-student',
				'studentName',
				'First student',
				values.studentName,
				'text',
				'off',
				'Who the lessons are for. If the parent takes lessons, enter their name. You can add more students on the next page.'
			)}
			<div class="field">
				<label class="check">
					<input type="checkbox" name="invite" checked={values.invite} />
					Email them a link to set a password
				</label>
				<p class="hint">
					They can also do this later with "Forgot password" or "Create account" using this email.
					Either way, lessons you book for them are confirmed by email.
				</p>
			</div>
			<button class="button" type="submit">Add family</button>
		</form>
	</details>
</section>

{#snippet field(
	id: string,
	name: string,
	label: string,
	value: string,
	type: string,
	autocomplete: 'name' | 'email' | 'off',
	hint = ''
)}
	<div class="field">
		<label for={id}>{label}</label>
		<input
			{id}
			{name}
			{type}
			{value}
			{autocomplete}
			aria-invalid={errors[name] ? 'true' : undefined}
			aria-describedby={[hint ? `${id}-hint` : '', errors[name] ? `${id}-error` : '']
				.filter(Boolean)
				.join(' ') || undefined}
		/>
		{#if hint}
			<p class="hint" id="{id}-hint">{hint}</p>
		{/if}
		{#if errors[name]}
			<p class="error" id="{id}-error">{errors[name]}</p>
		{/if}
	</div>
{/snippet}

{#if data.families.length === 0}
	<p class="card empty">No families yet.</p>
{:else}
	<ul class="list">
		{#each data.families as f (f.id)}
			<li class="card">
				<h2><a href="/admin/families/{f.id}">{f.name}</a></h2>
				{#if f.deleted}
					<p class="meta">Deleted their account</p>
				{:else}
					<p class="meta"><a href="mailto:{f.email}">{f.email}</a></p>
				{/if}
				<p class="meta">
					{f.studentNames.length > 0 ? f.studentNames.join(', ') : 'No students yet'}
				</p>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	summary {
		cursor: pointer;
		font-weight: 600;
		min-height: var(--tap);
		display: flex;
		align-items: center;
	}
</style>
