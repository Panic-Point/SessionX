<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	type Errors = Partial<Record<string, string>>;

	/** The failed submission for this form, if the last action targeted it. */
	function failed(target: string): { name: string; errors: Errors } | null {
		return form?.target === target && form.values
			? { name: form.values.name, errors: form.errors }
			: null;
	}

	let busy = $state<string | null>(null);
	const track =
		(name: string): SubmitFunction =>
		() => {
			busy = name;
			return async ({ update }) => {
				await update({ reset: false });
				busy = null;
			};
		};
</script>

<svelte:head>
	<title>Manage family · Brenda Sings</title>
</svelte:head>

<main>
	<h1>Manage family</h1>

	{#if form?.message}
		<p class="banner" role="status">{form.message}</p>
	{/if}

	<section class="card" aria-labelledby="students-heading">
		<h2 id="students-heading">Students</h2>
		{#if data.students.length === 0}
			<p class="empty">No students yet. Add who the lessons are for below.</p>
		{:else}
			<ul class="students">
				{#each data.students as student (student.id)}
					{@const retry = failed(student.id)}
					{@const prefix = `student-${student.id}`}
					<li>
						<form method="POST" action="?/renameStudent" novalidate use:enhance={track(student.id)}>
							<input type="hidden" name="id" value={student.id} />
							<label class="visually-hidden" for="{prefix}-name">Name for {student.name}</label>
							<div class="inline">
								<input
									id="{prefix}-name"
									name="name"
									maxlength="100"
									value={retry?.name ?? student.name}
									aria-invalid={retry?.errors.name ? 'true' : undefined}
									aria-describedby={retry?.errors.name ? `${prefix}-name-error` : undefined}
								/>
								<button class="button secondary" type="submit" disabled={busy === student.id}>
									{busy === student.id ? 'Saving…' : 'Rename'}
								</button>
							</div>
							{#if retry?.errors.name}
								<p class="error" id="{prefix}-name-error">{retry.errors.name}</p>
							{/if}
						</form>
					</li>
				{/each}
			</ul>
		{/if}

		{#key data.students.length}
			{@const retry = failed('add')}
			<form class="add" method="POST" action="?/addStudent" novalidate use:enhance={track('add')}>
				<label for="add-name">Add a student</label>
				<div class="inline">
					<input
						id="add-name"
						name="name"
						maxlength="100"
						value={retry?.name ?? ''}
						aria-invalid={retry?.errors.name ? 'true' : undefined}
						aria-describedby={retry?.errors.name ? 'add-name-hint add-name-error' : 'add-name-hint'}
					/>
					<button class="button" type="submit" disabled={busy === 'add'}>
						{busy === 'add' ? 'Adding…' : 'Add'}
					</button>
				</div>
				<p class="hint" id="add-name-hint">Use your own name if the lessons are for you.</p>
				{#if retry?.errors.name}
					<p class="error" id="add-name-error">{retry.errors.name}</p>
				{/if}
			</form>
		{/key}
	</section>
</main>

<style>
	.students {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.students li {
		margin-bottom: 0.75rem;
	}

	.add {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}

	.inline {
		display: flex;
		gap: 0.5rem;
	}
</style>
