<script lang="ts">
	import PeriodControl from '#lib/components/PeriodControl.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Lesson = PageProps['data']['upcoming'][number];

	/** The student filter, kept on the period links and the custom range form. */
	const keep = $derived<Record<string, string>>(data.student ? { student: data.student.id } : {});

	function studentHref(studentId: string | null): string {
		const query = new URLSearchParams(data.periodParams);
		if (studentId) query.set('student', studentId);
		const search = query.toString();
		return search ? `/account?${search}` : '/account';
	}

	const forWhom = $derived(data.student ? ` for ${data.student.name}` : '');
</script>

<svelte:head>
	<title>My lessons · Brenda Sings</title>
</svelte:head>

{#snippet lessonList(lessons: Lesson[], labelledBy?: string)}
	<ul class="lessons" aria-labelledby={labelledBy}>
		{#each lessons as lesson (lesson.id)}
			<li>
				<div class="lesson-main">
					<p class="lesson-title">{lesson.studentName} · {lesson.lessonTypeName}</p>
					<p class="meta">{lesson.whenLabel} · {lesson.priceLabel}</p>
					<span class="badge {lesson.status}">{lesson.statusLabel}</span>
					{#if lesson.seriesLabel}<span class="badge">{lesson.seriesLabel}</span>{/if}
					{#if lesson.lateCancel}<span class="badge">Late cancellation</span>{/if}
				</div>
				{#if lesson.canCancel}
					<a
						class="button secondary"
						href="/account/cancel/{lesson.id}"
						aria-label="Cancel {lesson.lessonTypeName} for {lesson.studentName} on {lesson.whenLabel}"
						>Cancel</a
					>
				{/if}
			</li>
		{/each}
	</ul>
{/snippet}

<main>
	<header class="intro">
		<h1>My lessons</h1>
		<a class="button" href="/book">Book a lesson</a>
	</header>

	{#if data.cancelled}
		<p class="banner" role="status">Lesson cancelled.</p>
	{/if}

	<section class="card" aria-labelledby="filters-heading">
		<h2 id="filters-heading" class="visually-hidden">Show lessons</h2>
		{#if data.students.length > 1}
			<nav class="chips" aria-label="Student">
				<a href={studentHref(null)} aria-current={data.student ? undefined : 'page'}>All students</a
				>
				{#each data.students as s (s.id)}
					<a href={studentHref(s.id)} aria-current={data.student?.id === s.id ? 'page' : undefined}
						>{s.name}</a
					>
				{/each}
			</nav>
		{/if}
		<PeriodControl period={data.period} path="/account" {keep} showLabel={false} />
		{#if data.inPeriod}
			<h3 id="period-heading">Lessons{forWhom}, {data.period?.label}</h3>
			{#if data.inPeriod.length === 0}
				<p class="empty">No lessons in this period.</p>
			{:else}
				{@render lessonList(data.inPeriod, 'period-heading')}
			{/if}
		{/if}
	</section>

	{#if !data.period}
		<section class="card" aria-labelledby="upcoming-heading">
			<h2 id="upcoming-heading">Upcoming lessons{forWhom}</h2>
			{#if data.upcoming.length === 0}
				<p class="empty">No upcoming lessons. <a href="/book">Book a lesson</a></p>
			{:else}
				{@render lessonList(data.upcoming)}
			{/if}
		</section>

		<section class="card" aria-labelledby="past-heading">
			<h2 id="past-heading">Past lessons{forWhom}</h2>
			{#if data.past.length === 0}
				<p class="empty">No past lessons yet.</p>
			{:else}
				{@render lessonList(data.past)}
			{/if}
		</section>
	{/if}
</main>

<style>
	.intro {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.intro h1 {
		margin: 0;
	}

	h3 {
		font-size: 1.1rem;
		margin: 0 0 0.75rem;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
		margin-bottom: 0.75rem;
	}

	.chips a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
		padding: 0 0.85rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
		color: var(--text);
		font-size: 0.95rem;
		font-weight: 600;
		text-decoration: none;
	}

	.chips a[aria-current='page'] {
		background: var(--accent);
		border-color: var(--accent);
		color: #fff;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.lessons li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.75rem 0;
		border-top: 1px solid var(--border);
	}

	.lessons li:first-child {
		border-top: 0;
		padding-top: 0;
	}

	.lesson-title {
		margin: 0;
		font-weight: 600;
	}

	.meta {
		margin: 0.1rem 0 0.35rem;
		color: var(--muted);
	}

	.badge {
		display: inline-block;
		padding: 0.1rem 0.6rem;
		border-radius: 999px;
		background: #eef0f3;
		color: var(--muted);
		font-size: 0.8rem;
		font-weight: 600;
	}

	.badge.pending {
		background: #fff4e5;
		color: #8a4b00;
	}

	.badge.approved {
		background: #e7f6ec;
		color: #146c2e;
	}
</style>
