<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';

	interface Props {
		lesson: {
			lessonTypeName: string;
			studentName: string;
			whenLabel: string;
			durationMin: number;
			priceLabel: string;
			statusLabel: string;
			canCancel: boolean;
			lateWarning: string | null;
			policyText: string;
		};
		/** Where "Keep lesson" goes. */
		backHref: string;
		/** Why the last cancel attempt failed, if it did. */
		message?: string | null;
	}

	let { lesson, backHref, message = null }: Props = $props();

	let submitting = $state(false);
</script>

<main>
	<a class="back" href={backHref}>‹ Back</a>

	<div class="card">
		<h1>Cancel this lesson?</h1>

		<dl>
			<div>
				<dt>Lesson</dt>
				<dd>{lesson.lessonTypeName} · {lesson.durationMin} min</dd>
			</div>
			<div>
				<dt>Student</dt>
				<dd>{lesson.studentName}</dd>
			</div>
			<div>
				<dt>Time</dt>
				<dd>{lesson.whenLabel}</dd>
			</div>
			<div>
				<dt>Price</dt>
				<dd>{lesson.priceLabel}</dd>
			</div>
			<div>
				<dt>Status</dt>
				<dd>{lesson.statusLabel}</dd>
			</div>
		</dl>

		{#if message}
			<p class="error" role="alert">{message}</p>
		{/if}

		{#if !lesson.canCancel}
			<p class="notice" role="status">This lesson can no longer be cancelled online.</p>
			<a class="button secondary" href={backHref}>Back</a>
		{:else}
			{#if lesson.lateWarning}
				<div class="warning" role="note">
					<p><strong>{lesson.lateWarning}</strong></p>
					{#if lesson.policyText}<p class="policy">{lesson.policyText}</p>{/if}
				</div>
			{/if}

			<form
				method="POST"
				use:enhance={() => {
					submitting = true;
					return async ({ result, update }) => {
						await update();
						// A failed cancel (for example, lateness changed) must show the current warning.
						if (result.type === 'failure') await invalidateAll();
						submitting = false;
					};
				}}
			>
				<!-- Lets the server refuse to cancel if lateness changed since this page was shown. -->
				<input type="hidden" name="shownLate" value={lesson.lateWarning ? 'true' : 'false'} />
				<button class="button danger" type="submit" disabled={submitting}>
					{submitting ? 'Cancelling…' : 'Cancel lesson'}
				</button>
				<a class="button secondary" href={backHref}>Keep lesson</a>
			</form>
		{/if}
	</div>
</main>

<style>
	main {
		max-width: 520px;
		margin: 0 auto;
	}

	.back {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
		font-weight: 600;
		text-decoration: none;
	}

	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.5rem 1.25rem;
		margin-top: 0.75rem;
	}

	h1 {
		font-size: 1.4rem;
		margin: 0 0 1rem;
	}

	dl {
		margin: 0;
		display: grid;
		gap: 0.75rem;
	}

	dt {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	dd {
		margin: 0.1rem 0 0;
	}

	.warning {
		margin-top: 1.25rem;
		padding: 0.75rem 1rem;
		border-radius: var(--radius);
		background: #fff4e5;
		border: 1px solid #f5c98a;
		color: #6b3a00;
	}

	.warning p {
		margin: 0;
	}

	.warning .policy {
		margin-top: 0.5rem;
		white-space: pre-line;
	}

	.notice {
		margin: 1.25rem 0 0.75rem;
		color: var(--muted);
	}

	.error {
		margin: 1.25rem 0 0;
		color: var(--danger);
		font-weight: 600;
	}

	form {
		display: grid;
		gap: 0.5rem;
		margin-top: 1.25rem;
	}

	.button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		min-height: var(--tap);
		padding: 0.75rem 1.5rem;
		border: 1px solid var(--accent);
		border-radius: 999px;
		background: var(--accent);
		color: #fff;
		font-family: inherit;
		font-size: 1rem;
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
	}

	.button.danger {
		background: var(--danger);
		border-color: var(--danger);
	}

	.button.danger:hover {
		background: #8f1c13;
	}

	.button.secondary {
		background: var(--surface);
		color: var(--accent);
	}

	.button:disabled {
		opacity: 0.7;
		cursor: progress;
	}
</style>
