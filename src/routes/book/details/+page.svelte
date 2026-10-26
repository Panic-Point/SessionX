<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let submitting = $state(false);

	const values = $derived(
		form?.values ?? { accountName: '', email: '', studentName: '', note: '' }
	);
	const errors: Partial<Record<string, string>> = $derived(form?.errors ?? {});
	const unavailable = $derived(!data.available || Boolean(errors.startsAt));
</script>

<svelte:head>
	<title>Your details · SessionX</title>
</svelte:head>

<main>
	<a class="back" href={data.backHref}>‹ Back to times</a>

	<section class="summary" aria-label="Lesson summary">
		<h1>{data.lessonType.name}</h1>
		<p class="when">{data.whenLabel}</p>
		<p class="meta">{data.lessonType.durationMin} min · {data.lessonType.priceLabel}</p>
		{#if data.student}
			<p class="meta">For {data.student.name}</p>
		{/if}
	</section>

	{#if unavailable}
		<div class="notice" role="alert">
			<p>{errors.startsAt ?? 'Sorry, that time is no longer available. Please pick another.'}</p>
			<a class="button" href={data.backHref}>Pick another time</a>
		</div>
	{:else}
		<form
			method="POST"
			novalidate
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update({ reset: false });
					submitting = false;
				};
			}}
		>
			<h2>{data.student ? 'Anything the teacher should know?' : 'Your details'}</h2>
			<input type="hidden" name="lessonTypeId" value={data.lessonType.id} />
			<input type="hidden" name="startsAt" value={data.startsAt} />

			{#if data.student}
				<input type="hidden" name="studentId" value={data.student.id} />
				{#if errors.studentId}
					<p class="error form-error" role="alert">
						{errors.studentId} <a href="/book">Choose a student</a>
					</p>
				{/if}
			{:else}
				<div class="field">
					<label for="accountName">Your name</label>
					<input
						id="accountName"
						name="accountName"
						autocomplete="name"
						required
						value={values.accountName}
						aria-invalid={errors.accountName ? 'true' : undefined}
						aria-describedby={errors.accountName ? 'accountName-error' : undefined}
					/>
					{#if errors.accountName}
						<p class="error" id="accountName-error">{errors.accountName}</p>
					{/if}
				</div>

				<div class="field">
					<label for="email">Email</label>
					<input
						id="email"
						name="email"
						type="email"
						autocomplete="email"
						required
						value={values.email}
						aria-invalid={errors.email ? 'true' : undefined}
						aria-describedby={errors.email ? 'email-error' : undefined}
					/>
					{#if errors.email}
						<p class="error" id="email-error">{errors.email}</p>
					{/if}
				</div>

				<div class="field">
					<label for="studentName">Student's name</label>
					<input
						id="studentName"
						name="studentName"
						required
						value={values.studentName}
						aria-invalid={errors.studentName ? 'true' : undefined}
						aria-describedby={errors.studentName
							? 'studentName-hint studentName-error'
							: 'studentName-hint'}
					/>
					<p class="hint" id="studentName-hint">
						Who is the lesson for? Use your own name if it's for you.
					</p>
					{#if errors.studentName}
						<p class="error" id="studentName-error">{errors.studentName}</p>
					{/if}
				</div>
			{/if}

			<div class="field">
				<label for="note">Note <span class="optional">(optional)</span></label>
				<textarea
					id="note"
					name="note"
					rows="3"
					maxlength="1000"
					value={values.note}
					aria-invalid={errors.note ? 'true' : undefined}
					aria-describedby={errors.note ? 'note-error' : undefined}></textarea>
				{#if errors.note}
					<p class="error" id="note-error">{errors.note}</p>
				{/if}
			</div>

			<button class="button" type="submit" disabled={submitting}>
				{submitting ? 'Sending…' : 'Request lesson'}
			</button>
			<p class="fine-print">You'll get an email once the teacher approves your request.</p>
		</form>
	{/if}
</main>

<style>
	main {
		max-width: 560px;
		margin: 0 auto;
	}

	.back {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
		font-weight: 600;
		text-decoration: none;
	}

	.summary,
	form,
	.notice {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.25rem;
		margin-top: 0.75rem;
	}

	h1 {
		font-size: 1.35rem;
		margin: 0 0 0.25rem;
	}

	h2 {
		font-size: 1.1rem;
		margin: 0 0 1rem;
	}

	.when {
		margin: 0;
		font-weight: 600;
	}

	.meta {
		margin: 0.25rem 0 0;
		color: var(--muted);
	}

	.field {
		margin-bottom: 1rem;
	}

	label {
		display: block;
		font-weight: 600;
		margin-bottom: 0.25rem;
	}

	.optional {
		font-weight: 400;
		color: var(--muted);
	}

	input,
	textarea {
		width: 100%;
		min-height: var(--tap);
		padding: 0.6rem 0.75rem;
		border: 1px solid #c4c9d1;
		border-radius: 8px;
		background: #fff;
		color: var(--text);
		font-family: inherit;
		/* 16px keeps iOS Safari from zooming in on focus. */
		font-size: 1rem;
	}

	textarea {
		resize: vertical;
	}

	input[aria-invalid='true'],
	textarea[aria-invalid='true'] {
		border-color: var(--danger);
	}

	.hint {
		margin: 0.25rem 0 0;
		font-size: 0.875rem;
		color: var(--muted);
	}

	.error {
		margin: 0.25rem 0 0;
		font-size: 0.875rem;
		color: var(--danger);
	}

	.button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		min-height: var(--tap);
		padding: 0.75rem 1.5rem;
		border: 0;
		border-radius: 999px;
		background: var(--accent);
		color: #fff;
		font-family: inherit;
		font-size: 1rem;
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
	}

	.button:hover {
		background: var(--accent-hover);
	}

	.button:disabled {
		opacity: 0.7;
		cursor: progress;
	}

	.fine-print {
		margin: 0.75rem 0 0;
		font-size: 0.875rem;
		color: var(--muted);
		text-align: center;
	}

	.form-error {
		margin: 0 0 1rem;
	}

	.notice p {
		margin: 0 0 1rem;
	}
</style>
