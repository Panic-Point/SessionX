<script lang="ts">
	interface Props {
		/** Weeks Sun→Sat from `monthGrid`, `null` for padding cells. */
		grid: (string | null)[][];
		/** Heading, e.g. "November 2026". */
		monthLabel: string;
		/** yyyy-MM-dd → number of open times. Dates not listed are unavailable. */
		available: Record<string, number>;
		selectedDate: string | null;
		dayHref: (date: string) => string;
		/** `null` hides the link. */
		prevHref: string | null;
		nextHref: string | null;
	}

	let { grid, monthLabel, available, selectedDate, dayHref, prevHref, nextHref }: Props = $props();

	const weekdays = [
		['S', 'Sunday'],
		['M', 'Monday'],
		['T', 'Tuesday'],
		['W', 'Wednesday'],
		['T', 'Thursday'],
		['F', 'Friday'],
		['S', 'Saturday']
	] as const;

	// Calendar dates carry no time zone; format them as UTC so server and browser agree.
	const longDate = new Intl.DateTimeFormat('en-US', {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		year: 'numeric',
		timeZone: 'UTC'
	});

	function label(date: string): string {
		const text = longDate.format(new Date(`${date}T00:00:00Z`));
		const count = available[date] ?? 0;
		if (count === 0) return `${text}, no times available`;
		return `${text}, ${count} ${count === 1 ? 'time' : 'times'} available`;
	}

	function dayNumber(date: string): number {
		return Number(date.slice(8, 10));
	}
</script>

<div class="calendar">
	<div class="header">
		{#if prevHref}
			<a
				class="nav"
				href={prevHref}
				aria-label="Previous month"
				data-sveltekit-noscroll
				data-sveltekit-keepfocus>‹</a
			>
		{:else}
			<span class="nav placeholder" aria-hidden="true"></span>
		{/if}
		<h2 class="month" aria-live="polite">{monthLabel}</h2>
		{#if nextHref}
			<a
				class="nav"
				href={nextHref}
				aria-label="Next month"
				data-sveltekit-noscroll
				data-sveltekit-keepfocus>›</a
			>
		{:else}
			<span class="nav placeholder" aria-hidden="true"></span>
		{/if}
	</div>

	<table aria-label={monthLabel}>
		<thead>
			<tr>
				{#each weekdays as [short, long], i (i)}
					<th scope="col"><abbr title={long}>{short}</abbr></th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each grid as week, w (w)}
				<tr>
					{#each week as date, d (d)}
						<td>
							{#if date === null}
								<span class="day empty" aria-hidden="true"></span>
							{:else if available[date]}
								<a
									class="day open"
									class:selected={date === selectedDate}
									href={dayHref(date)}
									aria-label={label(date)}
									aria-current={date === selectedDate ? 'true' : undefined}
									data-sveltekit-noscroll
									data-sveltekit-keepfocus>{dayNumber(date)}</a
								>
							{:else}
								<button
									type="button"
									class="day closed"
									aria-label={label(date)}
									aria-disabled="true"
									disabled>{dayNumber(date)}</button
								>
							{/if}
						</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.calendar {
		width: 100%;
	}

	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.5rem;
	}

	.month {
		font-size: 1.05rem;
		font-weight: 600;
		margin: 0;
	}

	.nav {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var(--tap);
		height: var(--tap);
		border-radius: 50%;
		font-size: 1.5rem;
		line-height: 1;
		text-decoration: none;
		color: var(--accent);
	}

	a.nav:hover {
		background: var(--accent-soft);
	}

	table {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
	}

	th {
		padding: 0.25rem 0;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--muted);
		text-transform: uppercase;
	}

	abbr {
		text-decoration: none;
	}

	td {
		padding: 2px;
		text-align: center;
	}

	.day {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		max-width: 48px;
		min-height: var(--tap);
		aspect-ratio: 1;
		border-radius: 50%;
		font-size: 0.95rem;
		font-variant-numeric: tabular-nums;
	}

	.open {
		background: var(--accent-soft);
		color: var(--accent);
		font-weight: 700;
		text-decoration: none;
	}

	.open:hover {
		background: #d3e4f8;
	}

	.open.selected {
		background: var(--accent);
		color: #fff;
	}

	.closed {
		border: 0;
		background: none;
		padding: 0;
		font-family: inherit;
		color: #a9afb8;
		cursor: default;
	}
</style>
