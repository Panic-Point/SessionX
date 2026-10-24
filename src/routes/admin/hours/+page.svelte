<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	interface Row {
		key: number;
		start: string;
		end: string;
		error: string | null;
	}

	const WEEKDAYS = [
		[1, 'Monday'],
		[2, 'Tuesday'],
		[3, 'Wednesday'],
		[4, 'Thursday'],
		[5, 'Friday'],
		[6, 'Saturday'],
		[7, 'Sunday']
	] as const;

	// Keys only identify rows for keyed {#each}; they never reach the server.
	let nextKey = 0;
	const blankRow = (): Row => ({ key: nextKey++, start: '', end: '', error: null });

	const weeklyResult = $derived(form?.weekly);
	const weeklyErrors: Partial<Record<string, string>> = $derived(
		weeklyResult && 'errors' in weeklyResult ? weeklyResult.errors : {}
	);

	/** Rows per weekday: the rejected submission after a failed save, else the stored hours. */
	let days = $derived.by(() => {
		const source =
			weeklyResult && 'rows' in weeklyResult
				? weeklyResult.rows
				: data.weekly.map((w) => ({ ...w, weekday: String(w.weekday), error: null }));
		const byDay: Record<number, Row[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
		for (const r of source) {
			byDay[Number(r.weekday)]?.push({
				key: nextKey++,
				start: r.start,
				end: r.end,
				error: r.error
			});
		}
		return byDay;
	});

	function addRow(weekday: number) {
		days = { ...days, [weekday]: [...days[weekday], blankRow()] };
	}

	function removeRow(weekday: number, key: number) {
		days = { ...days, [weekday]: days[weekday].filter((r) => r.key !== key) };
	}

	const overrideResult = $derived(form?.override);
	const overrideValues = $derived(
		overrideResult && 'values' in overrideResult ? overrideResult.values : null
	);
	const overrideErrors: Partial<Record<string, string>> = $derived(
		overrideResult && 'errors' in overrideResult ? overrideResult.errors : {}
	);
	let overrideClosed = $derived(overrideValues?.isClosed ?? false);
	let overrideRanges = $derived<Row[]>(
		overrideValues && overrideValues.ranges.length > 0
			? overrideValues.ranges.map((r) => ({ ...r, key: nextKey++, error: null }))
			: [blankRow()]
	);

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
	<title>Hours · Admin · SessionX</title>
</svelte:head>

<h1>Hours</h1>

<section class="card" aria-labelledby="weekly-heading">
	<h2 id="weekly-heading">Weekly hours</h2>
	<p class="meta intro">Times are in the studio time zone. Leave a day empty to keep it closed.</p>

	{#if weeklyResult && 'saved' in weeklyResult}
		<p class="banner" role="status">Weekly hours saved.</p>
	{:else if weeklyResult}
		<p class="banner bad" role="alert">Please fix the highlighted times.</p>
	{/if}

	<form method="POST" action="?/weekly" novalidate use:enhance={track('weekly')}>
		{#each WEEKDAYS as [weekday, dayName] (weekday)}
			{@const dayError = weeklyErrors[`weekday-${weekday}`]}
			<fieldset class="day" aria-describedby={dayError ? `weekday-${weekday}-error` : undefined}>
				<legend>{dayName}</legend>
				{#if days[weekday].length === 0}
					<p class="meta closed">Closed</p>
				{/if}
				{#each days[weekday] as row, i (row.key)}
					<div class="range">
						<input type="hidden" name="weekday" value={weekday} />
						<div class="time">
							<label for="w-{row.key}-start">From</label>
							<input
								id="w-{row.key}-start"
								name="start"
								type="time"
								value={row.start}
								aria-invalid={row.error ? 'true' : undefined}
								aria-describedby={row.error ? `w-${row.key}-error` : undefined}
							/>
						</div>
						<div class="time">
							<label for="w-{row.key}-end">To</label>
							<input
								id="w-{row.key}-end"
								name="end"
								type="time"
								value={row.end}
								aria-invalid={row.error ? 'true' : undefined}
								aria-describedby={row.error ? `w-${row.key}-error` : undefined}
							/>
						</div>
						<button
							class="button secondary remove"
							type="button"
							aria-label="Remove {dayName} hours {i + 1}"
							onclick={() => removeRow(weekday, row.key)}
						>
							Remove
						</button>
						{#if row.error}
							<p class="error full" id="w-{row.key}-error">{row.error}</p>
						{/if}
					</div>
				{/each}
				{#if dayError}
					<p class="error" id="weekday-{weekday}-error">{dayError}</p>
				{/if}
				<button class="link-button" type="button" onclick={() => addRow(weekday)}>
					+ Add hours
				</button>
			</fieldset>
		{/each}
		<button class="button" type="submit" disabled={busy === 'weekly'}>
			{busy === 'weekly' ? 'Saving…' : 'Save weekly hours'}
		</button>
	</form>
</section>

<section class="card" aria-labelledby="overrides-heading">
	<h2 id="overrides-heading">Date overrides</h2>
	<p class="meta intro">Close a day or set special hours for one date.</p>

	{#if overrideResult && 'saved' in overrideResult}
		<p class="banner" role="status">Override saved.</p>
	{:else if overrideResult && 'deleted' in overrideResult}
		<p class="banner" role="status">Override removed.</p>
	{/if}

	{#if data.overrides.length === 0}
		<p class="empty">No upcoming overrides.</p>
	{:else}
		<ul class="overrides">
			{#each data.overrides as o (o.date)}
				<li>
					<div>
						<strong>{o.dateLabel}</strong>
						<p class="meta">
							{o.isClosed ? 'Closed' : o.ranges.map((r) => `${r.start}–${r.end}`).join(', ')}
							{#if o.note}· {o.note}{/if}
						</p>
					</div>
					<form method="POST" action="?/deleteOverride" use:enhance={track(`delete-${o.date}`)}>
						<input type="hidden" name="date" value={o.date} />
						<button
							class="button danger"
							type="submit"
							aria-label="Delete override for {o.dateLabel}"
							disabled={busy === `delete-${o.date}`}
						>
							Delete
						</button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}

	<form
		class="add"
		method="POST"
		action="?/saveOverride"
		novalidate
		use:enhance={track('override')}
	>
		<h3>Add an override</h3>
		<div class="field">
			<label for="override-date">Date</label>
			<input
				id="override-date"
				name="date"
				type="date"
				min={data.today}
				value={overrideValues?.date ?? ''}
				aria-invalid={overrideErrors.date ? 'true' : undefined}
				aria-describedby={overrideErrors.date ? 'override-date-error' : undefined}
			/>
			{#if overrideErrors.date}
				<p class="error" id="override-date-error">{overrideErrors.date}</p>
			{/if}
		</div>

		<div class="field">
			<label class="check">
				<input
					type="checkbox"
					name="isClosed"
					checked={overrideClosed}
					onchange={(e) => (overrideClosed = e.currentTarget.checked)}
				/>
				Closed all day
			</label>
		</div>

		{#if !overrideClosed}
			<fieldset
				class="day"
				aria-describedby={overrideErrors.ranges ? 'override-ranges-error' : undefined}
			>
				<legend>Opening times</legend>
				{#each overrideRanges as row, i (row.key)}
					<div class="range">
						<div class="time">
							<label for="o-{row.key}-start">From</label>
							<input
								id="o-{row.key}-start"
								name="start"
								type="time"
								value={row.start}
								aria-invalid={overrideErrors.ranges ? 'true' : undefined}
							/>
						</div>
						<div class="time">
							<label for="o-{row.key}-end">To</label>
							<input
								id="o-{row.key}-end"
								name="end"
								type="time"
								value={row.end}
								aria-invalid={overrideErrors.ranges ? 'true' : undefined}
							/>
						</div>
						<button
							class="button secondary remove"
							type="button"
							aria-label="Remove opening time {i + 1}"
							onclick={() => (overrideRanges = overrideRanges.filter((r) => r.key !== row.key))}
						>
							Remove
						</button>
					</div>
				{/each}
				{#if overrideErrors.ranges}
					<p class="error" id="override-ranges-error">{overrideErrors.ranges}</p>
				{/if}
				<button
					class="link-button"
					type="button"
					onclick={() => (overrideRanges = [...overrideRanges, blankRow()])}
				>
					+ Add hours
				</button>
			</fieldset>
		{/if}

		<div class="field">
			<label for="override-note">Note <span class="optional">(optional)</span></label>
			<input
				id="override-note"
				name="note"
				maxlength="200"
				value={overrideValues?.note ?? ''}
				aria-invalid={overrideErrors.note ? 'true' : undefined}
				aria-describedby={overrideErrors.note ? 'override-note-error' : undefined}
			/>
			{#if overrideErrors.note}
				<p class="error" id="override-note-error">{overrideErrors.note}</p>
			{/if}
		</div>

		<button class="button" type="submit" disabled={busy === 'override'}>
			{busy === 'override' ? 'Saving…' : 'Save override'}
		</button>
	</form>
</section>

<style>
	.intro {
		margin: -0.5rem 0 1rem;
	}

	.day {
		margin: 0 0 1rem;
		padding: 0.75rem 1rem;
		border: 1px solid var(--border);
		border-radius: 8px;
	}

	legend {
		padding: 0 0.25rem;
		font-weight: 700;
	}

	.closed {
		margin: 0 0 0.25rem;
	}

	.range {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.time {
		flex: 1 1 8rem;
	}

	.time label {
		font-size: 0.875rem;
	}

	.remove {
		flex: 0 0 auto;
	}

	.full {
		flex-basis: 100%;
	}

	.link-button {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
		padding: 0;
		border: 0;
		background: none;
		color: var(--accent);
		font-family: inherit;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
	}

	.overrides {
		margin: 0 0 1.25rem;
		padding: 0;
		list-style: none;
	}

	.overrides li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.75rem 0;
		border-bottom: 1px solid var(--border);
	}

	.add {
		max-width: 560px;
	}

	h3 {
		font-size: 1rem;
		margin: 0 0 0.75rem;
	}

	.optional {
		font-weight: 400;
		color: var(--muted);
	}
</style>
