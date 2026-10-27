<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	type Values = (typeof data.lessonTypes)[number]['values'];
	type Errors = Partial<Record<string, string>>;

	const EMPTY: Values = {
		name: '',
		description: '',
		durationMin: '60',
		price: '',
		sortOrder: '0',
		active: 'on'
	};

	/** The failed submission for this form, if the last action targeted it. */
	function failed(target: string): { values: Values; errors: Errors } | null {
		return form?.target === target && form.values
			? { values: form.values, errors: form.errors }
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

	function describedBy(prefix: string, name: string, errors: Errors, hint = false) {
		const ids = [
			hint ? `${prefix}-${name}-hint` : '',
			errors[name] ? `${prefix}-${name}-error` : ''
		]
			.filter(Boolean)
			.join(' ');
		return ids || undefined;
	}
</script>

<svelte:head>
	<title>Lesson types · Admin · Brenda Sings</title>
</svelte:head>

{#snippet fields(prefix: string, values: Values, errors: Errors)}
	{#if errors.form}
		<p class="error" role="alert">{errors.form}</p>
	{/if}
	<div class="field">
		<label for="{prefix}-name">Name</label>
		<input
			id="{prefix}-name"
			name="name"
			maxlength="100"
			value={values.name}
			aria-invalid={errors.name ? 'true' : undefined}
			aria-describedby={describedBy(prefix, 'name', errors)}
		/>
		{#if errors.name}<p class="error" id="{prefix}-name-error">{errors.name}</p>{/if}
	</div>
	<div class="field">
		<label for="{prefix}-description">Description <span class="optional">(optional)</span></label>
		<textarea
			id="{prefix}-description"
			name="description"
			rows="2"
			maxlength="500"
			value={values.description}
			aria-invalid={errors.description ? 'true' : undefined}
			aria-describedby={describedBy(prefix, 'description', errors)}></textarea>
		{#if errors.description}
			<p class="error" id="{prefix}-description-error">{errors.description}</p>
		{/if}
	</div>
	<div class="grid">
		<div class="field">
			<label for="{prefix}-durationMin">Length (minutes)</label>
			<input
				id="{prefix}-durationMin"
				name="durationMin"
				type="number"
				inputmode="numeric"
				value={values.durationMin}
				aria-invalid={errors.durationMin ? 'true' : undefined}
				aria-describedby={describedBy(prefix, 'durationMin', errors)}
			/>
			{#if errors.durationMin}
				<p class="error" id="{prefix}-durationMin-error">{errors.durationMin}</p>
			{/if}
		</div>
		<div class="field">
			<label for="{prefix}-price">Price ($)</label>
			<input
				id="{prefix}-price"
				name="price"
				inputmode="decimal"
				value={values.price}
				aria-invalid={errors.price ? 'true' : undefined}
				aria-describedby={describedBy(prefix, 'price', errors)}
			/>
			{#if errors.price}<p class="error" id="{prefix}-price-error">{errors.price}</p>{/if}
		</div>
		<div class="field">
			<label for="{prefix}-sortOrder">Sort order</label>
			<input
				id="{prefix}-sortOrder"
				name="sortOrder"
				type="number"
				inputmode="numeric"
				value={values.sortOrder}
				aria-invalid={errors.sortOrder ? 'true' : undefined}
				aria-describedby={describedBy(prefix, 'sortOrder', errors, true)}
			/>
			<p class="hint" id="{prefix}-sortOrder-hint">Lower numbers are listed first.</p>
			{#if errors.sortOrder}
				<p class="error" id="{prefix}-sortOrder-error">{errors.sortOrder}</p>
			{/if}
		</div>
	</div>
	<div class="field">
		<label class="check">
			<input type="checkbox" name="active" checked={values.active === 'on'} />
			Offered for booking
		</label>
	</div>
{/snippet}

<h1>Lesson types</h1>

{#if form?.message}
	<p class="banner" role="status">{form.message}</p>
{/if}

<ul class="list">
	{#each data.lessonTypes as t (t.id)}
		{@const retry = failed(t.id)}
		<li class="card">
			<div class="head">
				<h2>{t.values.name}</h2>
				{#if !t.active}<span class="badge">Inactive</span>{/if}
			</div>
			<p class="meta">{t.durationMin} min · {t.priceLabel}</p>
			{#if t.values.description}<p class="description">{t.values.description}</p>{/if}

			<details open={Boolean(retry)}>
				<summary class="button secondary">Edit</summary>
				<form method="POST" action="?/update" novalidate use:enhance={track(t.id)}>
					<input type="hidden" name="id" value={t.id} />
					{@render fields(`edit-${t.id}`, retry?.values ?? t.values, retry?.errors ?? {})}
					<button class="button" type="submit" disabled={busy === t.id}>
						{busy === t.id ? 'Saving…' : 'Save changes'}
					</button>
				</form>
			</details>
		</li>
	{/each}
</ul>

<section class="card" aria-labelledby="create-heading">
	<h2 id="create-heading">Add a lesson type</h2>
	{#key data.lessonTypes.length}
		{@const retry = failed('create')}
		<form method="POST" action="?/create" novalidate use:enhance={track('create')}>
			{@render fields('create', retry?.values ?? EMPTY, retry?.errors ?? {})}
			<button class="button" type="submit" disabled={busy === 'create'}>
				{busy === 'create' ? 'Adding…' : 'Add lesson type'}
			</button>
		</form>
	{/key}
</section>

<style>
	.list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	.head h2 {
		margin: 0;
	}

	.description {
		margin: 0.5rem 0 0;
	}

	details {
		margin-top: 0.75rem;
	}

	summary {
		list-style: none;
		width: max-content;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	details form {
		margin-top: 1rem;
		max-width: 560px;
	}

	section form {
		max-width: 560px;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: 0 0.75rem;
	}

	.optional {
		font-weight: 400;
		color: var(--muted);
	}
</style>
