<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import PeriodControl from '#lib/components/PeriodControl.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	type Errors = Partial<Record<string, string>>;

	/** The failed submission for this form, if the last action targeted it. */
	function failed(target: string): { name: string; errors: Errors } | null {
		return form?.target === target && form.values
			? { name: form.values.name, errors: form.errors }
			: null;
	}

	const passwordErrors: Errors = $derived(form?.target === 'password' ? form.errors : {});

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
	<title>My lessons · SessionX</title>
</svelte:head>

<main>
	<header class="intro">
		<h1>My lessons</h1>
		<a class="button" href="/book">Book a lesson</a>
	</header>

	{#if data.cancelled}
		<p class="banner" role="status">Lesson cancelled.</p>
	{/if}
	{#if form?.message}
		<p class="banner" role="status">{form.message}</p>
	{/if}

	<section class="card" aria-labelledby="lessons-heading">
		<h2 id="lessons-heading" class="visually-hidden">Show lessons</h2>
		<PeriodControl period={data.period} path="/account" showLabel={false} />
		{#if data.inPeriod}
			<h3 id="period-heading">Lessons, {data.period?.label}</h3>
			{#if data.inPeriod.length === 0}
				<p class="empty">No lessons in this period.</p>
			{:else}
				<ul class="lessons" aria-labelledby="period-heading">
					{#each data.inPeriod as lesson (lesson.id)}
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
			{/if}
		{/if}
	</section>

	{#if !data.period}
		<section class="card" aria-labelledby="upcoming-heading">
			<h2 id="upcoming-heading">Upcoming lessons</h2>
			{#if data.upcoming.length === 0}
				<p class="empty">No upcoming lessons. <a href="/book">Book a lesson</a></p>
			{:else}
				<ul class="lessons">
					{#each data.upcoming as lesson (lesson.id)}
						<li>
							<div class="lesson-main">
								<p class="lesson-title">{lesson.studentName} · {lesson.lessonTypeName}</p>
								<p class="meta">{lesson.whenLabel} · {lesson.priceLabel}</p>
								<span class="badge {lesson.status}">{lesson.statusLabel}</span>
								{#if lesson.seriesLabel}<span class="badge">{lesson.seriesLabel}</span>{/if}
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
			{/if}
		</section>
	{/if}

	<section class="card" aria-labelledby="students-heading">
		<h2 id="students-heading">Students</h2>
		{#if data.students.length === 0}
			<p class="empty">No students yet. Add who the lessons are for below.</p>
		{:else}
			<ul class="students">
				{#each data.students as student (student.id)}
					{@const retry = failed(student.id)}
					{@const prefix = `student-${student.id}`}
					<li>
						<form method="POST" action="?/renameStudent" novalidate use:enhance={track(student.id)}>
							<input type="hidden" name="id" value={student.id} />
							<label class="visually-hidden" for="{prefix}-name">Name for {student.name}</label>
							<div class="inline">
								<input
									id="{prefix}-name"
									name="name"
									maxlength="100"
									value={retry?.name ?? student.name}
									aria-invalid={retry?.errors.name ? 'true' : undefined}
									aria-describedby={retry?.errors.name ? `${prefix}-name-error` : undefined}
								/>
								<button class="button secondary" type="submit" disabled={busy === student.id}>
									{busy === student.id ? 'Saving…' : 'Rename'}
								</button>
							</div>
							{#if retry?.errors.name}
								<p class="error" id="{prefix}-name-error">{retry.errors.name}</p>
							{/if}
						</form>
					</li>
				{/each}
			</ul>
		{/if}

		{#key data.students.length}
			{@const retry = failed('add')}
			<form class="add" method="POST" action="?/addStudent" novalidate use:enhance={track('add')}>
				<label for="add-name">Add a student</label>
				<div class="inline">
					<input
						id="add-name"
						name="name"
						maxlength="100"
						value={retry?.name ?? ''}
						aria-invalid={retry?.errors.name ? 'true' : undefined}
						aria-describedby={retry?.errors.name ? 'add-name-hint add-name-error' : 'add-name-hint'}
					/>
					<button class="button" type="submit" disabled={busy === 'add'}>
						{busy === 'add' ? 'Adding…' : 'Add'}
					</button>
				</div>
				<p class="hint" id="add-name-hint">Use your own name if the lessons are for you.</p>
				{#if retry?.errors.name}
					<p class="error" id="add-name-error">{retry.errors.name}</p>
				{/if}
			</form>
		{/key}
	</section>

	<section class="card" aria-labelledby="password-heading">
		<h2 id="password-heading">Password</h2>
		<p class="empty">
			{data.hasPassword
				? 'Change the password you sign in with.'
				: 'Set a password so you can sign in next time.'}
		</p>
		<form
			class="password"
			method="POST"
			action="?/password"
			novalidate
			use:enhance={() => {
				busy = 'password';
				return async ({ update }) => {
					// Never keep password values in the form after a submit.
					await update({ reset: true });
					busy = null;
				};
			}}
		>
			<!-- Lets password managers file the new password under the right account. -->
			<input type="hidden" name="username" autocomplete="username" value={data.email} />
			{#if data.hasPassword}
				<div class="field">
					<label for="currentPassword">Current password</label>
					<input
						id="currentPassword"
						name="currentPassword"
						type="password"
						autocomplete="current-password"
						aria-invalid={passwordErrors.currentPassword ? 'true' : undefined}
						aria-describedby={passwordErrors.currentPassword ? 'currentPassword-error' : undefined}
					/>
					{#if passwordErrors.currentPassword}
						<p class="error" id="currentPassword-error">{passwordErrors.currentPassword}</p>
					{/if}
				</div>
			{/if}
			<div class="field">
				<label for="password">{data.hasPassword ? 'New password' : 'Password'}</label>
				<input
					id="password"
					name="password"
					type="password"
					autocomplete="new-password"
					maxlength="128"
					aria-invalid={passwordErrors.password ? 'true' : undefined}
					aria-describedby={passwordErrors.password ? 'password-error' : 'password-hint'}
				/>
				{#if passwordErrors.password}
					<p class="error" id="password-error">{passwordErrors.password}</p>
				{:else}
					<p class="hint" id="password-hint">At least 10 characters.</p>
				{/if}
			</div>
			<div class="field">
				<label for="confirmPassword">Confirm password</label>
				<input
					id="confirmPassword"
					name="confirmPassword"
					type="password"
					autocomplete="new-password"
					aria-invalid={passwordErrors.confirmPassword ? 'true' : undefined}
					aria-describedby={passwordErrors.confirmPassword ? 'confirmPassword-error' : undefined}
				/>
				{#if passwordErrors.confirmPassword}
					<p class="error" id="confirmPassword-error">{passwordErrors.confirmPassword}</p>
				{/if}
			</div>
			<button class="button" type="submit" disabled={busy === 'password'}>
				{busy === 'password' ? 'Saving…' : data.hasPassword ? 'Change password' : 'Set password'}
			</button>
		</form>
	</section>

	{#if !data.period}
		<section class="card" aria-labelledby="past-heading">
			<h2 id="past-heading">Past lessons</h2>
			{#if data.past.length === 0}
				<p class="empty">No past lessons yet.</p>
			{:else}
				<ul class="lessons">
					{#each data.past as lesson (lesson.id)}
						<li>
							<div class="lesson-main">
								<p class="lesson-title">{lesson.studentName} · {lesson.lessonTypeName}</p>
								<p class="meta">{lesson.whenLabel} · {lesson.priceLabel}</p>
								<span class="badge {lesson.status}">{lesson.statusLabel}</span>
								{#if lesson.lateCancel}<span class="badge">Late cancellation</span>{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</main>

<style>
	main {
		max-width: 720px;
		margin: 0 auto;
	}

	.intro {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	h1 {
		font-size: 1.5rem;
		margin: 0;
	}

	h2,
	h3 {
		font-size: 1.1rem;
		margin: 0 0 0.75rem;
	}

	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.25rem;
		margin-bottom: 1rem;
	}

	.banner {
		padding: 0.75rem 1rem;
		border-radius: var(--radius);
		margin: 0 0 1rem;
		background: var(--accent-soft);
		border: 1px solid #b9d4f1;
	}

	.empty {
		margin: 0;
		color: var(--muted);
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

	.students li {
		margin-bottom: 0.75rem;
	}

	.add {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}

	label {
		display: block;
		font-weight: 600;
		margin-bottom: 0.25rem;
	}

	.password .field {
		margin: 1rem 0;
	}

	.password input {
		width: 100%;
	}

	.inline {
		display: flex;
		gap: 0.5rem;
	}

	input {
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

	input[aria-invalid='true'] {
		border-color: var(--danger);
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

	.button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: var(--tap);
		padding: 0.6rem 1.25rem;
		border: 1px solid var(--accent);
		border-radius: 999px;
		background: var(--accent);
		color: #fff;
		font-family: inherit;
		font-size: 1rem;
		font-weight: 600;
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
	}

	.button:hover {
		background: var(--accent-hover);
	}

	.button.secondary {
		background: var(--surface);
		color: var(--accent);
	}

	.button:disabled {
		opacity: 0.7;
		cursor: progress;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
