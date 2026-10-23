<script lang="ts">
	import MonthCalendar from '#lib/components/MonthCalendar.svelte';
	import TimeList from '#lib/components/TimeList.svelte';
	import { monthGrid, shiftMonth } from '#lib/components/month.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Calendar dates carry no time zone; format them as UTC so server and browser agree.
	const monthFormat = new Intl.DateTimeFormat('en-US', {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC'
	});
	const dayFormat = new Intl.DateTimeFormat('en-US', {
		weekday: 'long',
		month: 'long',
		day: 'numeric',
		timeZone: 'UTC'
	});

	function bookHref(params: Record<string, string>): string {
		return `/book?${new URLSearchParams(params)}`;
	}
</script>

<svelte:head>
	<title>Book a lesson · SessionX</title>
</svelte:head>

<main>
	{#if data.step === 'type'}
		<header class="intro">
			<h1>Book a lesson</h1>
			<p>Choose a lesson length to see open times.</p>
		</header>

		{#if data.lessonTypes.length === 0}
			<p class="muted">No lessons are open for booking right now. Please check back soon.</p>
		{:else}
			<ul class="types">
				{#each data.lessonTypes as type (type.id)}
					<li>
						<a class="type-card" href={bookHref({ type: type.id })}>
							<span class="type-name">{type.name}</span>
							{#if type.description}
								<span class="type-description">{type.description}</span>
							{/if}
							<span class="type-meta">{type.durationMin} min · {type.priceLabel}</span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	{:else}
		{@const typeId = data.lessonType.id}
		{@const month = data.month}
		{@const prevMonth = shiftMonth(month, -1)}
		{@const nextMonth = shiftMonth(month, 1)}

		<header class="chosen">
			<div>
				<h1>{data.lessonType.name}</h1>
				<p class="muted">{data.lessonType.durationMin} min · {data.lessonType.priceLabel}</p>
			</div>
			<a class="change" href="/book">Change</a>
		</header>

		<div class="picker">
			<section class="pane" aria-label="Choose a date">
				<MonthCalendar
					grid={monthGrid(month)}
					monthLabel={monthFormat.format(new Date(`${month}-01T00:00:00Z`))}
					available={data.available}
					selectedDate={data.selectedDate}
					dayHref={(date) => bookHref({ type: typeId, month, date })}
					prevHref={prevMonth >= data.currentMonth
						? bookHref({ type: typeId, month: prevMonth })
						: null}
					nextHref={nextMonth <= data.lastMonth
						? bookHref({ type: typeId, month: nextMonth })
						: null}
				/>
				<p class="tz">Times shown in {data.timezoneLabel}</p>
			</section>

			<div class="pane">
				{#if data.selectedDate}
					<TimeList
						heading={dayFormat.format(new Date(`${data.selectedDate}T00:00:00Z`))}
						times={data.times}
						timeHref={(iso) => `/book/details?${new URLSearchParams({ type: typeId, start: iso })}`}
					/>
				{:else}
					<div class="no-times">
						<h2>No open times this month</h2>
						{#if nextMonth <= data.lastMonth}
							<p>
								<a href={bookHref({ type: typeId, month: nextMonth })} data-sveltekit-noscroll
									>Check next month</a
								>
							</p>
						{:else}
							<p class="muted">Please check back soon.</p>
						{/if}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</main>

<style>
	h1 {
		font-size: 1.5rem;
		margin: 0 0 0.25rem;
	}

	.muted {
		color: var(--muted);
		margin: 0;
	}

	.intro {
		margin-bottom: 1.25rem;
	}

	.intro p {
		color: var(--muted);
		margin: 0;
	}

	.types {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.75rem;
	}

	.type-card {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-height: var(--tap);
		padding: 1rem 1.25rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-left: 4px solid var(--accent);
		border-radius: var(--radius);
		color: var(--text);
		text-decoration: none;
	}

	.type-card:hover {
		border-color: var(--accent);
	}

	.type-name {
		font-weight: 600;
		font-size: 1.1rem;
	}

	.type-description {
		color: var(--muted);
	}

	.type-meta {
		font-weight: 600;
		color: var(--accent);
	}

	.chosen {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.change {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
		padding: 0 0.75rem;
		font-weight: 600;
	}

	.picker {
		display: grid;
		gap: 1rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1rem;
	}

	.picker > .pane + .pane {
		border-top: 1px solid var(--border);
		padding-top: 1rem;
	}

	.tz {
		margin: 0.75rem 0 0;
		font-size: 0.875rem;
		color: var(--muted);
	}

	.no-times h2 {
		font-size: 1.05rem;
		margin: 0 0 0.5rem;
	}

	.no-times a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
	}

	@media (min-width: 768px) {
		.picker {
			grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
			gap: 2rem;
			padding: 1.5rem;
		}

		.picker > .pane + .pane {
			border-top: 0;
			padding-top: 0;
			border-left: 1px solid var(--border);
			padding-left: 2rem;
		}
	}
</style>
