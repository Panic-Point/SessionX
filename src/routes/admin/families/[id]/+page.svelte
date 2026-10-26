<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// Submitted values and errors apply only to the form that was submitted.
	type Kind = 'notes' | 'prices';
	type Failed = {
		kind: Kind;
		target: string;
		errors: Record<string, string>;
		notes?: string;
		prices?: Record<string, string>;
	};
	const failed = $derived<Failed | null>(form && 'errors' in form ? (form as Failed) : null);
	const saved = $derived(
		form && 'saved' in form ? { kind: form.kind as Kind, target: form.target } : null
	);

	function wasSaved(target: string, kind: Kind): boolean {
		return saved !== null && saved.target === target && saved.kind === kind;
	}

	function errorsFor(target: string, kind: Kind): Record<string, string> {
		return failed && failed.target === target && failed.kind === kind ? failed.errors : {};
	}

	function notesValue(target: string, stored: string): string {
		return failed &&
			failed.kind === 'notes' &&
			failed.target === target &&
			failed.notes !== undefined
			? failed.notes
			: stored;
	}

	function priceValue(studentId: string, lessonTypeId: string, stored: string): string {
		if (failed && failed.kind === 'prices' && failed.target === studentId && failed.prices) {
			return failed.prices[lessonTypeId] ?? stored;
		}
		return stored;
	}
</script>

<svelte:head>
	<title>{data.family.name} · Admin · SessionX</title>
</svelte:head>

<p><a href="/admin/families">&larr; Families</a></p>
<h1>{data.family.name}</h1>
<p class="meta"><a href="mailto:{data.family.email}">{data.family.email}</a></p>

{#snippet notesForm(target: string, action: string, studentId: string | null, stored: string)}
	{@const errs = errorsFor(target, 'notes')}
	{#if wasSaved(target, 'notes')}
		<p class="banner" role="status">Notes saved.</p>
	{/if}
	{#if errs.form}
		<p class="banner bad" role="alert">{errs.form}</p>
	{/if}
	<form method="POST" {action} use:enhance>
		{#if studentId}
			<input type="hidden" name="studentId" value={studentId} />
		{/if}
		<div class="field">
			<label for="notes-{target}">Notes</label>
			<textarea
				id="notes-{target}"
				name="notes"
				rows="3"
				aria-invalid={errs.notes ? 'true' : undefined}
				aria-describedby={errs.notes ? `notes-error-${target}` : undefined}
				>{notesValue(target, stored)}</textarea
			>
			{#if errs.notes}
				<p class="error" id="notes-error-{target}">{errs.notes}</p>
			{/if}
		</div>
		<button class="button secondary" type="submit">Save notes</button>
	</form>
{/snippet}

<section class="card">
	<h2>Account notes</h2>
	{@render notesForm('account', '?/accountNotes', null, data.family.adminNotes)}
</section>

{#each data.family.students as s (s.id)}
	{@const errs = errorsFor(s.id, 'prices')}
	<section class="card">
		<h2>{s.name}</h2>

		{@render notesForm(s.id, '?/studentNotes', s.id, s.notes)}

		<h3>Prices</h3>
		{#if wasSaved(s.id, 'prices')}
			<p class="banner" role="status">Prices saved.</p>
		{/if}
		{#if errs.form}
			<p class="banner bad" role="alert">{errs.form}</p>
		{/if}
		<form method="POST" action="?/prices" use:enhance>
			<input type="hidden" name="studentId" value={s.id} />
			<table>
				<thead>
					<tr>
						<th scope="col">Lesson type</th>
						<th scope="col">List price</th>
						<th scope="col">Custom price ($)</th>
					</tr>
				</thead>
				<tbody>
					{#each s.prices as p (p.lessonTypeId)}
						{@const err = errs[p.lessonTypeId]}
						<tr>
							<th scope="row">{p.lessonTypeName}</th>
							<td>{p.listPriceLabel}</td>
							<td>
								<label class="sr" for="price-{s.id}-{p.lessonTypeId}">
									Custom price for {p.lessonTypeName}
								</label>
								<input
									id="price-{s.id}-{p.lessonTypeId}"
									name="price-{p.lessonTypeId}"
									inputmode="decimal"
									placeholder="List price"
									value={priceValue(s.id, p.lessonTypeId, p.customPrice)}
									aria-invalid={err ? 'true' : undefined}
									aria-describedby={err ? `price-error-${s.id}-${p.lessonTypeId}` : undefined}
								/>
								{#if err}
									<p class="error" id="price-error-{s.id}-{p.lessonTypeId}">{err}</p>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="hint">Leave blank to use the list price.</p>
			<button class="button" type="submit">Save prices</button>
		</form>
	</section>
{/each}

{#if data.family.students.length === 0}
	<p class="card empty">No students yet.</p>
{/if}

<style>
	h3 {
		font-size: 1rem;
		margin: 1.25rem 0 0.5rem;
	}

	table {
		width: 100%;
		border-collapse: collapse;
	}

	th,
	td {
		padding: 0.4rem 0.5rem 0.4rem 0;
		text-align: left;
		vertical-align: top;
	}

	tbody th {
		font-weight: 600;
	}

	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
