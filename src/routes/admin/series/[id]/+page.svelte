<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let busy = $state<string | null>(null);
	// One choice for every cancel button on the page; each form posts it as a hidden field.
	let notify = $state(true);
	const track =
		(key: string): SubmitFunction =>
		() => {
			busy = key;
			return async ({ update }) => {
				await update();
				busy = null;
			};
		};
</script>

<svelte:head>
	<title>{data.series.studentName} · {data.series.scheduleLabel} · Admin · Brenda Sings</title>
</svelte:head>

<p><a href="/admin/families/{data.series.accountId}">&larr; {data.series.accountName}</a></p>
<h1>{data.series.studentName}: {data.series.scheduleLabel}</h1>
<p class="meta">
	{data.series.lessonTypeName} · {data.series.durationMin} min · {data.series.priceLabel} per lesson
</p>
<p class="meta">Starting {data.series.startsOnLabel} · {data.series.endLabel}</p>
{#if data.series.note}
	<p class="meta">Note: {data.series.note}</p>
{/if}
{#if data.series.ended}
	<p class="badge">Ended {data.series.endedLabel}</p>
{/if}

{#if form?.message}
	<p class="banner" role="status">{form.message}</p>
{/if}

<section class="card">
	<h2>Lessons</h2>
	{#if data.lessons.some((l) => l.canCancel)}
		<div class="field">
			<label class="check" for="notify">
				<input id="notify" type="checkbox" bind:checked={notify} />
				Email the family when I cancel
			</label>
			<p class="hint">Untick to cancel quietly, for example when you've already told them.</p>
		</div>
	{/if}
	{#if data.lessons.length === 0}
		<p class="empty">No lessons in this series yet.</p>
	{:else}
		<ul class="lessons">
			{#each data.lessons as l (l.id)}
				<li>
					<div>
						<p class="when">{l.whenLabel}</p>
						<span class="badge {l.status === 'approved' ? 'ok' : ''}">{l.statusLabel}</span>
						{#if l.lateCancel}<span class="badge">Late cancellation</span>{/if}
					</div>
					{#if l.canCancel}
						<div class="actions">
							<form method="POST" action="?/cancelLesson" use:enhance={track(l.id)}>
								<input type="hidden" name="id" value={l.id} />
								<input type="hidden" name="notify" value={notify ? 'on' : ''} />
								<button class="button secondary" type="submit" disabled={busy !== null}>
									Cancel this lesson
								</button>
							</form>
							{#if !data.series.ended}
								<form method="POST" action="?/endFrom" use:enhance={track(`from-${l.id}`)}>
									<input type="hidden" name="from" value={l.startsAtIso} />
									<input type="hidden" name="notify" value={notify ? 'on' : ''} />
									<button class="button secondary" type="submit" disabled={busy !== null}>
										Cancel this and later
									</button>
								</form>
							{/if}
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

{#if !data.series.ended}
	<section class="card">
		<h2>End this series</h2>
		<p>
			Cancels all {data.series.upcomingCount} upcoming
			{data.series.upcomingCount === 1 ? 'lesson' : 'lessons'} and stops new ones being added. Past lessons
			stay as they are. The family gets one email saying which lessons were cancelled.
		</p>
		<p class="hint">
			To change the day, time or lesson type, cancel from the first lesson that should change, then
			set up a new series on the family's page.
		</p>
		<details>
			<summary>Cancel remaining lessons…</summary>
			<form method="POST" action="?/endFrom" use:enhance={track('end')}>
				<div class="field">
					<label class="check" for="end-notify">
						<input id="end-notify" type="checkbox" bind:checked={notify} />
						Email the family
					</label>
				</div>
				<input type="hidden" name="notify" value={notify ? 'on' : ''} />
				<button class="button danger" type="submit" disabled={busy !== null}>
					Yes, cancel remaining lessons
				</button>
			</form>
		</details>
	</section>
{/if}

<style>
	.lessons {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.lessons li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.6rem 0;
		border-bottom: 1px solid var(--border);
	}

	.when {
		margin: 0 0 0.25rem;
		font-weight: 600;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	summary {
		cursor: pointer;
		font-weight: 600;
		min-height: var(--tap);
		display: flex;
		align-items: center;
	}
</style>
