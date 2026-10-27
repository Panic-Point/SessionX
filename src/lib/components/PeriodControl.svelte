<script lang="ts">
	type PeriodParams = Record<string, string>;

	/** The parts of a parsed period (see #lib/server/periods.ts) this control shows. */
	interface PeriodView {
		kind: 'week' | 'month' | 'custom';
		label: string;
		error: string | null;
		note: string | null;
		fromInput: string;
		toInput: string;
		prev: PeriodParams | null;
		current: PeriodParams | null;
		next: PeriodParams | null;
	}

	interface Props {
		/** The chosen period, or null for the page's default view. */
		period: PeriodView | null;
		path: string;
		/** Other query params the links and the custom form keep, e.g. { unpaid: '1' }. */
		keep?: Record<string, string>;
		/** False when the page shows the period's label in its own heading. */
		showLabel?: boolean;
	}

	let { period, path, keep = {}, showLabel = true }: Props = $props();

	function href(params: PeriodParams | null): string {
		const query = new URLSearchParams({ ...keep, ...(params ?? {}) }).toString();
		return query ? `${path}?${query}` : path;
	}

	const unit = $derived(period?.kind === 'month' ? 'month' : 'week');
	const kinds = [
		{ kind: null, label: 'All' },
		{ kind: 'week', label: 'Week' },
		{ kind: 'month', label: 'Month' },
		{ kind: 'custom', label: 'Custom' }
	] as const;
</script>

<div class="period">
	<nav class="kinds" aria-label="Period">
		{#each kinds as k (k.label)}
			<a
				href={href(k.kind ? { period: k.kind } : null)}
				aria-current={(period?.kind ?? null) === k.kind ? 'page' : undefined}>{k.label}</a
			>
		{/each}
	</nav>

	{#if period && period.kind !== 'custom'}
		<nav class="steps" aria-label="Change {unit}">
			<a href={href(period.prev)}>‹ Previous</a>
			<a href={href(period.current)}>This {unit}</a>
			<a href={href(period.next)}>Next ›</a>
		</nav>
	{:else if period}
		<form class="custom" method="GET" action={path}>
			{#each Object.entries(keep) as [name, value] (name)}
				<input type="hidden" {name} {value} />
			{/each}
			<input type="hidden" name="period" value="custom" />
			<label>
				From
				<input type="date" name="from" value={period.fromInput} required />
			</label>
			<label>
				To
				<input type="date" name="to" value={period.toInput} required />
			</label>
			<button class="apply" type="submit">Apply</button>
		</form>
	{/if}

	{#if period?.error}
		<p class="error" role="alert">{period.error}</p>
	{:else if period}
		{#if showLabel}<p class="label">{period.label}</p>{/if}
		{#if period.note}<p class="note">{period.note}</p>{/if}
	{/if}
</div>

<style>
	.period {
		margin-bottom: 1rem;
	}

	nav {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin-bottom: 0.5rem;
	}

	nav a,
	.apply {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
		padding: 0 0.85rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
		color: var(--text);
		font-family: inherit;
		font-size: 0.95rem;
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
	}

	.kinds a[aria-current='page'] {
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
	}

	.steps a {
		color: var(--accent);
	}

	.custom {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.custom label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-weight: 600;
		/* Two inputs side by side fit at 375px; narrower screens wrap. */
		flex: 1 1 9rem;
		min-width: 0;
	}

	.custom input {
		min-height: var(--tap);
		padding: 0.5rem 0.6rem;
		border: 1px solid #c4c9d1;
		border-radius: 8px;
		background: #fff;
		color: var(--text);
		font-family: inherit;
		/* 16px keeps iOS Safari from zooming in on focus. */
		font-size: 1rem;
		min-width: 0;
	}

	.apply {
		border-color: var(--accent);
		background: var(--accent);
		color: #fff;
	}

	.label {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 700;
	}

	.note {
		margin: 0.25rem 0 0;
		font-size: 0.875rem;
		color: var(--muted);
	}

	.error {
		margin: 0;
		color: var(--danger);
		font-weight: 600;
	}
</style>
