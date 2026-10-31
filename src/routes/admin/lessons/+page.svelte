<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import PeriodControl from '#lib/components/PeriodControl.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let busyId = $state<string | null>(null);

	function href(range: 'upcoming' | 'past' | 'late-cancels', unpaidOnly: boolean): string {
		const params = new URLSearchParams(data.periodQuery);
		if (range !== 'upcoming') params.set('range', range);
		if (unpaidOnly) params.set('unpaid', '1');
		const query = params.toString();
		return query ? `/admin/lessons?${query}` : '/admin/lessons';
	}

	const submit: SubmitFunction = ({ formData }) => {
		busyId = String(formData.get('id'));
		return async ({ update }) => {
			await update();
			busyId = null;
		};
	};
</script>

<svelte:head>
	<title>Lessons · Admin · Brenda Sings</title>
</svelte:head>

<h1>Lessons</h1>

<PeriodControl
	period={data.period}
	path="/admin/lessons"
	keep={{
		...(data.range === 'late-cancels' ? { range: 'late-cancels' } : {}),
		...(data.unpaidOnly ? { unpaid: '1' } : {})
	}}
/>

<div class="controls">
	<nav class="tabs" aria-label="Lesson range">
		{#if data.period}
			<a
				href={href('upcoming', data.unpaidOnly)}
				aria-current={data.range !== 'late-cancels' ? 'page' : undefined}
			>
				Lessons
			</a>
		{:else}
			<a
				href={href('upcoming', data.unpaidOnly)}
				aria-current={data.range === 'upcoming' ? 'page' : undefined}
			>
				Upcoming
			</a>
			<a
				href={href('past', data.unpaidOnly)}
				aria-current={data.range === 'past' ? 'page' : undefined}
			>
				Past
			</a>
		{/if}
		<a
			href={href('late-cancels', false)}
			aria-current={data.range === 'late-cancels' ? 'page' : undefined}
		>
			Late cancels
		</a>
	</nav>
	{#if data.range !== 'late-cancels'}
		<a
			class="toggle"
			href={href(data.range, !data.unpaidOnly)}
			role="switch"
			aria-checked={data.unpaidOnly}
		>
			<span class="box" aria-hidden="true">{data.unpaidOnly ? '✓' : ''}</span>
			Unpaid only
		</a>
	{/if}
</div>

{#if form?.message}
	<p class="banner bad" role="alert">{form.message}</p>
{:else if form && 'cancelled' in form}
	<p class="banner" role="status">{form.cancelled}</p>
{/if}

{#if data.period?.error}
	<!-- PeriodControl shows the error; there is no list to show. -->
{:else if data.lessons.length === 0}
	<p class="card empty">
		{data.period
			? data.range === 'late-cancels'
				? `No late cancellations in ${data.period.label}.`
				: data.unpaidOnly
					? `No unpaid lessons in ${data.period.label}.`
					: `No lessons in ${data.period.label}.`
			: data.unpaidOnly
				? 'No unpaid lessons.'
				: data.range === 'past'
					? 'No past lessons.'
					: data.range === 'late-cancels'
						? 'No late cancellations.'
						: 'No upcoming lessons.'}
	</p>
{:else}
	{#if data.summary}
		<p class="summary">{data.summary}</p>
	{/if}
	<ul class="list">
		{#each data.lessons as l (l.id)}
			<li class="card row">
				<div class="info">
					<h2>{l.studentName}</h2>
					<p class="when">{l.whenLabel}</p>
					<p class="meta">{l.lessonTypeName} · {l.durationMin} min · {l.priceLabel}</p>
					{#if l.seriesId}
						<p class="meta"><a href="/admin/series/{l.seriesId}">{l.seriesLabel}</a></p>
					{/if}
					<p class="meta">
						{l.accountName} · <a href="mailto:{l.accountEmail}">{l.accountEmail}</a>
					</p>
				</div>
				<div class="pay">
					{#if l.paid}
						<span class="badge ok">Paid ✓</span>
						<form method="POST" action="?/unpaid" use:enhance={submit}>
							<input type="hidden" name="id" value={l.id} />
							<button class="button secondary" type="submit" disabled={busyId === l.id}>
								Mark unpaid
							</button>
						</form>
					{:else}
						<form method="POST" action="?/paid" use:enhance={submit}>
							<input type="hidden" name="id" value={l.id} />
							<button class="button" type="submit" disabled={busyId === l.id}>Mark paid</button>
						</form>
					{/if}
				</div>
				{#if l.canCancel}
					<details class="cancel">
						<summary>Cancel lesson…</summary>
						<form method="POST" action="?/cancel" use:enhance={submit}>
							<input type="hidden" name="id" value={l.id} />
							<div class="field">
								<label for="reason-{l.id}">Reason for the family (optional)</label>
								<textarea id="reason-{l.id}" name="reason" rows="2" maxlength="500"></textarea>
							</div>
							<div class="field">
								<label class="check" for="notify-{l.id}">
									<input id="notify-{l.id}" type="checkbox" name="notify" checked />
									Email the family
								</label>
							</div>
							<button class="button danger" type="submit" disabled={busyId === l.id}>
								Yes, cancel lesson
							</button>
						</form>
					</details>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.tabs {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
		overflow: hidden;
	}

	.tabs a,
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		min-height: var(--tap);
		padding: 0 1rem;
		color: var(--text);
		font-weight: 600;
		text-decoration: none;
	}

	.tabs a[aria-current='page'] {
		background: var(--accent);
		color: #fff;
	}

	.box {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.25rem;
		height: 1.25rem;
		border: 2px solid #8a919c;
		border-radius: 4px;
		font-size: 0.85rem;
		line-height: 1;
	}

	.toggle[aria-checked='true'] .box {
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
	}

	.summary {
		margin: 0 0 0.75rem;
		font-weight: 600;
	}

	.list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.when {
		margin: 0;
		font-weight: 600;
	}

	.cancel {
		flex-basis: 100%;
	}

	.cancel summary {
		cursor: pointer;
		font-weight: 600;
		min-height: var(--tap);
		display: flex;
		align-items: center;
	}

	.pay {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
</style>
