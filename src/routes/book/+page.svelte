<script lang="ts">
	import { enhance } from '$app/forms';
	import MonthCalendar from '#lib/components/MonthCalendar.svelte';
	import TimeList from '#lib/components/TimeList.svelte';
	import { monthGrid, shiftMonth } from '#lib/components/month.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let adding = $state(false);
	const addErrors: Partial<Record<string, string>> = $derived(form?.errors ?? {});

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

	/** Signed in, every link carries the chosen student so prices and the request stay theirs. */
	function withStudent(params: Record<string, string>): URLSearchParams {
		return new URLSearchParams(data.student ? { student: data.student.id, ...params } : params);
	}

	function bookHref(params: Record<string, string>): string {
		const query = withStudent(params).toString();
		return query ? `/book?${query}` : '/book';
	}
</script>

<svelte:head>
	<title>Book a lesson · Brenda Sings</title>
</svelte:head>

{#snippet forStudent()}
	{#if data.student}
		<p class="for-student">
			For <strong>{data.student.name}</strong>
			<a class="change" href="/book" aria-label="Change student">Change</a>
		</p>
	{/if}
{/snippet}

<main>
	{#if data.step === 'student'}
		<header class="intro">
			<h1>Book a lesson</h1>
			<p>Who is this lesson for?</p>
		</header>

		{#if data.students.length > 0}
			<ul class="types" aria-label="Students">
				{#each data.students as student (student.id)}
					<li>
						<a class="type-card" href={bookHref({ student: student.id })}>
							<span class="type-name">{student.name}</span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}

		<form
			class="add-student"
			method="POST"
			action="?/addStudent"
			novalidate
			use:enhance={() => {
				adding = true;
				return async ({ update }) => {
					await update({ reset: false });
					adding = false;
				};
			}}
		>
			<label for="student-name">Add a student</label>
			<div class="inline">
				<input
					id="student-name"
					name="name"
					maxlength="100"
					value={form?.values?.name ?? ''}
					aria-invalid={addErrors.name ? 'true' : undefined}
					aria-describedby={addErrors.name
						? 'student-name-hint student-name-error'
						: 'student-name-hint'}
				/>
				<button class="add-button" type="submit" disabled={adding}>
					{adding ? 'Adding…' : 'Add'}
				</button>
			</div>
			<p class="hint" id="student-name-hint">Use your own name if the lesson is for you.</p>
			{#if addErrors.name}
				<p class="error" id="student-name-error">{addErrors.name}</p>
			{/if}
		</form>
	{:else if data.step === 'type'}
		<header class="intro">
			<h1>Book a lesson</h1>
			<p>Choose a lesson length to see open times.</p>
		</header>
		{@render forStudent()}

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
			<a class="change" href={bookHref({})} aria-label="Change lesson type">Change</a>
		</header>
		{@render forStudent()}

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
						timeHref={(iso) => `/book/details?${withStudent({ type: typeId, start: iso })}`}
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

	.for-student {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		margin: -0.75rem 0 1rem;
	}

	.add-student {
		margin-top: 1.25rem;
		padding: 1rem 1.25rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}

	.add-student label {
		display: block;
		font-weight: 600;
		margin-bottom: 0.25rem;
	}

	.inline {
		display: flex;
		gap: 0.5rem;
	}

	.add-student input {
		flex: 1;
		min-width: 0;
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

	.add-student input[aria-invalid='true'] {
		border-color: var(--danger);
	}

	.add-button {
		min-height: var(--tap);
		padding: 0.6rem 1.25rem;
		border: 0;
		border-radius: 999px;
		background: var(--accent);
		color: #fff;
		font-family: inherit;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
	}

	.add-button:hover {
		background: var(--accent-hover);
	}

	.add-button:disabled {
		opacity: 0.7;
		cursor: progress;
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
