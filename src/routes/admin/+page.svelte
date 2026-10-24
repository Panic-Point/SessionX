<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let busyId = $state<string | null>(null);

	const submit: SubmitFunction = ({ formData }) => {
		busyId = String(formData.get('id'));
		return async ({ update }) => {
			await update();
			busyId = null;
		};
	};
</script>

<svelte:head>
	<title>Requests · Admin · SessionX</title>
</svelte:head>

<h1>Requests</h1>

{#if form?.message}
	<p class="banner" class:bad={!form.ok} role={form.ok ? 'status' : 'alert'}>{form.message}</p>
{/if}

{#if data.requests.length === 0}
	<p class="card empty">No pending requests.</p>
{:else}
	<ul class="list">
		{#each data.requests as r (r.id)}
			<li class="card">
				<h2>{r.studentName}</h2>
				<p class="when">{r.whenLabel}</p>
				<p class="meta">{r.lessonTypeName} · {r.durationMin} min · {r.priceLabel}</p>
				<p class="meta">
					Booked by {r.accountName} ·
					<a href="mailto:{r.accountEmail}">{r.accountEmail}</a>
				</p>
				{#if r.note}
					<p class="note"><span class="label">Note:</span> {r.note}</p>
				{/if}

				<div class="actions">
					<form method="POST" action="?/approve" use:enhance={submit}>
						<input type="hidden" name="id" value={r.id} />
						<button class="button" type="submit" disabled={busyId === r.id}>Approve</button>
					</form>

					<details>
						<summary class="button secondary">Decline…</summary>
						<form method="POST" action="?/decline" use:enhance={submit}>
							<input type="hidden" name="id" value={r.id} />
							<div class="field">
								<label for="reason-{r.id}">
									Reason <span class="optional">(optional, sent to the booker)</span>
								</label>
								<textarea id="reason-{r.id}" name="reason" rows="2" maxlength="500"></textarea>
							</div>
							<button class="button danger" type="submit" disabled={busyId === r.id}>
								Decline request
							</button>
						</form>
					</details>
				</div>
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

	.when {
		margin: 0;
		font-weight: 600;
	}

	.note {
		margin: 0.75rem 0 0;
		white-space: pre-line;
	}

	.label {
		font-weight: 600;
	}

	.optional {
		font-weight: 400;
		color: var(--muted);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	details {
		flex: 1 1 16rem;
	}

	summary {
		list-style: none;
		width: max-content;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	details form {
		margin-top: 0.75rem;
	}
</style>
