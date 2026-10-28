<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// Submitted values and errors apply only to the form that was submitted.
	type Kind = 'notes' | 'prices' | 'series' | 'student' | 'book';
	type Failed = {
		kind: Kind;
		target: string;
		errors: Record<string, string>;
		notes?: string;
		name?: string;
		prices?: Record<string, string>;
		values?: Record<string, string>;
	};
	type Preview = {
		scheduleLabel: string;
		lessonTypeName: string;
		priceLabel: string;
		endLabel: string;
		bookable: number;
		continues: boolean;
		dates: { date: string; whenLabel: string; status: string; statusLabel: string }[];
	};
	type Created = {
		seriesId: string;
		booked: string[];
		skipped: { whenLabel: string; reason: string }[];
	};
	const failed = $derived<Failed | null>(form && 'errors' in form ? (form as Failed) : null);
	const saved = $derived(
		form && 'saved' in form ? { kind: form.kind as Kind, target: form.target } : null
	);

	function wasSaved(target: string, kind: Kind): boolean {
		return saved !== null && saved.target === target && saved.kind === kind;
	}

	function errorsFor(target: string, kind: Kind): Record<string, string> {
		return failed && failed.target === target && failed.kind === kind ? failed.errors : {};
	}

	function notesValue(target: string, stored: string): string {
		return failed &&
			failed.kind === 'notes' &&
			failed.target === target &&
			failed.notes !== undefined
			? failed.notes
			: stored;
	}

	const previewed = $derived(
		form && 'preview' in form
			? (form as unknown as { target: string; values: Record<string, string>; preview: Preview })
			: null
	);
	const created = $derived(
		form && 'created' in form ? (form as unknown as { target: string; created: Created }) : null
	);

	const booked = $derived(
		form && 'booked' in form
			? (form as unknown as { target: string; booked: { whenLabel: string; studentName: string } })
			: null
	);

	/** The values to show in a student's booking form: the last failed submission, else defaults. */
	function bookingValues(studentId: string): Record<string, string> {
		if (failed?.kind === 'book' && failed.target === studentId && failed.values) {
			return failed.values;
		}
		return {
			lessonTypeId: data.lessonTypes[0]?.id ?? '',
			date: '',
			time: '',
			note: ''
		};
	}

	const newStudentName = $derived(
		failed?.kind === 'student' && failed.name !== undefined ? failed.name : ''
	);

	const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

	/** The values to show in a student's series form: the last submission for it, else defaults. */
	function seriesValues(studentId: string): Record<string, string> {
		if (previewed?.target === studentId) return previewed.values;
		if (failed?.kind === 'series' && failed.target === studentId && failed.values) {
			return failed.values;
		}
		return {
			lessonTypeId: data.lessonTypes[0]?.id ?? '',
			weekday: '',
			startTime: '',
			intervalWeeks: '1',
			startsOn: data.today,
			endMode: 'count',
			endsOn: '',
			occurrenceCount: '10',
			note: ''
		};
	}

	function seriesOpen(studentId: string): boolean {
		return (
			previewed?.target === studentId || (failed?.kind === 'series' && failed.target === studentId)
		);
	}

	// Keep what the admin typed while the preview loads.
	const keepValues: SubmitFunction = () => {
		return async ({ update }) => update({ reset: false });
	};

	function priceValue(studentId: string, lessonTypeId: string, stored: string): string {
		if (failed && failed.kind === 'prices' && failed.target === studentId && failed.prices) {
			return failed.prices[lessonTypeId] ?? stored;
		}
		return stored;
	}
</script>

<svelte:head>
	<title>{data.family.name} · Admin · Brenda Sings</title>
</svelte:head>

<p><a href="/admin/families">&larr; Families</a></p>
<h1>{data.family.name}</h1>
{#if data.family.deleted}
	<p class="meta">
		This family deleted their account. Their past lessons are kept here for your records.
	</p>
{:else}
	<p class="meta"><a href="mailto:{data.family.email}">{data.family.email}</a></p>
{/if}
{#if data.created}
	<p class="banner" role="status">
		Family added.{data.created === 'invited'
			? ' We emailed them a link to set a password.'
			: ' They can set a password any time with "Forgot password" using this email.'}
	</p>
{/if}

{#snippet notesForm(target: string, action: string, studentId: string | null, stored: string)}
	{@const errs = errorsFor(target, 'notes')}
	{#if wasSaved(target, 'notes')}
		<p class="banner" role="status">Notes saved.</p>
	{/if}
	{#if errs.form}
		<p class="banner bad" role="alert">{errs.form}</p>
	{/if}
	<form method="POST" {action} use:enhance>
		{#if studentId}
			<input type="hidden" name="studentId" value={studentId} />
		{/if}
		<div class="field">
			<label for="notes-{target}">Notes</label>
			<textarea
				id="notes-{target}"
				name="notes"
				rows="3"
				aria-invalid={errs.notes ? 'true' : undefined}
				aria-describedby={errs.notes ? `notes-error-${target}` : undefined}
				>{notesValue(target, stored)}</textarea
			>
			{#if errs.notes}
				<p class="error" id="notes-error-{target}">{errs.notes}</p>
			{/if}
		</div>
		<button class="button secondary" type="submit">Save notes</button>
	</form>
{/snippet}

<section class="card">
	<h2>Account notes</h2>
	{@render notesForm('account', '?/accountNotes', null, data.family.adminNotes)}
</section>

{#each data.family.students as s (s.id)}
	{@const errs = errorsFor(s.id, 'prices')}
	<section class="card">
		<h2>{s.name}</h2>

		{@render notesForm(s.id, '?/studentNotes', s.id, s.notes)}

		<h3>Prices</h3>
		{#if wasSaved(s.id, 'prices')}
			<p class="banner" role="status">Prices saved.</p>
		{/if}
		{#if errs.form}
			<p class="banner bad" role="alert">{errs.form}</p>
		{/if}
		<form method="POST" action="?/prices" use:enhance>
			<input type="hidden" name="studentId" value={s.id} />
			<table>
				<thead>
					<tr>
						<th scope="col">Lesson type</th>
						<th scope="col">List price</th>
						<th scope="col">Custom price ($)</th>
					</tr>
				</thead>
				<tbody>
					{#each s.prices as p (p.lessonTypeId)}
						{@const err = errs[p.lessonTypeId]}
						<tr>
							<th scope="row">{p.lessonTypeName}</th>
							<td>{p.listPriceLabel}</td>
							<td>
								<label class="sr" for="price-{s.id}-{p.lessonTypeId}">
									Custom price for {p.lessonTypeName}
								</label>
								<input
									id="price-{s.id}-{p.lessonTypeId}"
									name="price-{p.lessonTypeId}"
									inputmode="decimal"
									placeholder="List price"
									value={priceValue(s.id, p.lessonTypeId, p.customPrice)}
									aria-invalid={err ? 'true' : undefined}
									aria-describedby={err ? `price-error-${s.id}-${p.lessonTypeId}` : undefined}
								/>
								{#if err}
									<p class="error" id="price-error-{s.id}-{p.lessonTypeId}">{err}</p>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<p class="hint">Leave blank to use the list price.</p>
			<button class="button" type="submit">Save prices</button>
		</form>

		{#if !data.family.deleted}
			{@render bookOne(s.id, s.name)}
		{/if}
		{@render recurring(s.id, s.name)}
	</section>
{/each}

{#snippet bookOne(studentId: string, studentName: string)}
	{@const errs = errorsFor(studentId, 'book')}
	{@const v = bookingValues(studentId)}
	{@const id = (field: string) => `book-${field}-${studentId}`}
	<h3>Book a lesson</h3>
	{#if booked?.target === studentId}
		<p class="banner" role="status">
			Booked {booked.booked.studentName} for {booked.booked.whenLabel}. The family has been emailed
			the confirmation.
		</p>
	{/if}
	<details open={failed?.kind === 'book' && failed.target === studentId}>
		<summary>Book one lesson for {studentName}</summary>
		<p class="hint">
			Confirmed straight away, at any time you choose: studio hours and booking notice don't apply.
			Times that clash with another lesson, a closed day or a busy Google Calendar can't be booked.
		</p>
		{#if errs.form}
			<p class="banner bad" role="alert">{errs.form}</p>
		{/if}
		{#if errs.studentId}
			<p class="banner bad" role="alert">{errs.studentId}</p>
		{/if}
		<form method="POST" action="?/book" novalidate use:enhance={keepValues}>
			<input type="hidden" name="studentId" value={studentId} />
			<div class="grid">
				{@render select(id('lessonTypeId'), 'lessonTypeId', 'Lesson type', v.lessonTypeId, errs, [
					...data.lessonTypes.map((t) => [t.id, t.name] as [string, string])
				])}
				<div class="field">
					<label for={id('date')}>Date</label>
					<input
						id={id('date')}
						name="date"
						type="date"
						min={data.today}
						value={v.date}
						aria-invalid={errs.date ? 'true' : undefined}
						aria-describedby={errs.date ? `${id('date')}-error` : undefined}
					/>
					{#if errs.date}
						<p class="error" id="{id('date')}-error">{errs.date}</p>
					{/if}
				</div>
				<div class="field">
					<label for={id('time')}>Time</label>
					<input
						id={id('time')}
						name="time"
						type="time"
						step="300"
						value={v.time}
						aria-invalid={errs.time ? 'true' : undefined}
						aria-describedby={errs.time ? `${id('time')}-error` : undefined}
					/>
					{#if errs.time}
						<p class="error" id="{id('time')}-error">{errs.time}</p>
					{/if}
				</div>
			</div>
			<div class="field">
				<label for={id('note')}>Note (shown to the family)</label>
				<textarea
					id={id('note')}
					name="note"
					rows="2"
					aria-invalid={errs.note ? 'true' : undefined}
					aria-describedby={errs.note ? `${id('note')}-error` : undefined}>{v.note}</textarea
				>
				{#if errs.note}
					<p class="error" id="{id('note')}-error">{errs.note}</p>
				{/if}
			</div>
			<button class="button" type="submit">Book and confirm</button>
		</form>
	</details>
{/snippet}

{#snippet recurring(studentId: string, studentName: string)}
	{@const list = data.series.filter((x) => x.studentId === studentId)}
	{@const errs = errorsFor(studentId, 'series')}
	{@const v = seriesValues(studentId)}
	{@const id = (field: string) => `series-${field}-${studentId}`}
	<h3>Recurring lessons</h3>
	{#if created?.target === studentId}
		<div class="banner" role="status">
			<p>
				Booked {created.created.booked.length}
				{created.created.booked.length === 1 ? 'lesson' : 'lessons'} for {studentName}.
				<a href="/admin/series/{created.created.seriesId}">View the series</a>
			</p>
			{#if created.created.skipped.length > 0}
				<p>Skipped:</p>
				<ul>
					{#each created.created.skipped as skip (skip.whenLabel)}
						<li>{skip.whenLabel}: {skip.reason}</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
	{#if list.length > 0}
		<ul class="series">
			{#each list as x (x.id)}
				<li>
					<a href="/admin/series/{x.id}">{x.scheduleLabel}</a>
					<span class="meta">
						· {x.lessonTypeName} · {x.endLabel} ·
						{x.ended ? 'Ended' : `${x.upcomingCount} upcoming`}
					</span>
				</li>
			{/each}
		</ul>
	{/if}

	<details open={seriesOpen(studentId)}>
		<summary>Set up recurring lessons</summary>
		{#if errs.form}
			<p class="banner bad" role="alert">{errs.form}</p>
		{/if}
		{#if errs.studentId}
			<p class="banner bad" role="alert">{errs.studentId}</p>
		{/if}
		<form method="POST" action="?/seriesPreview" novalidate use:enhance={keepValues}>
			<input type="hidden" name="studentId" value={studentId} />
			<div class="grid">
				{@render select(id('lessonTypeId'), 'lessonTypeId', 'Lesson type', v.lessonTypeId, errs, [
					...data.lessonTypes.map((t) => [t.id, t.name] as [string, string])
				])}
				{@render select(id('weekday'), 'weekday', 'Day', v.weekday, errs, [
					['', 'Choose a day'],
					...WEEKDAYS.map((name, i) => [String(i + 1), name] as [string, string])
				])}
				<div class="field">
					<label for={id('startTime')}>Time</label>
					<input
						id={id('startTime')}
						name="startTime"
						type="time"
						step="300"
						value={v.startTime}
						aria-invalid={errs.startTime ? 'true' : undefined}
						aria-describedby={errs.startTime ? `${id('startTime')}-error` : undefined}
					/>
					{#if errs.startTime}
						<p class="error" id="{id('startTime')}-error">{errs.startTime}</p>
					{/if}
				</div>
				{@render select(id('intervalWeeks'), 'intervalWeeks', 'Repeats', v.intervalWeeks, errs, [
					['1', 'Every week'],
					['2', 'Every 2 weeks']
				])}
				<div class="field">
					<label for={id('startsOn')}>Starting</label>
					<input
						id={id('startsOn')}
						name="startsOn"
						type="date"
						min={data.today}
						value={v.startsOn}
						aria-invalid={errs.startsOn ? 'true' : undefined}
						aria-describedby={errs.startsOn ? `${id('startsOn')}-error` : undefined}
					/>
					{#if errs.startsOn}
						<p class="error" id="{id('startsOn')}-error">{errs.startsOn}</p>
					{/if}
				</div>
				{@render select(id('endMode'), 'endMode', 'Ends', v.endMode, errs, [
					['count', 'After a number of lessons'],
					['date', 'On a date'],
					['none', 'No end date']
				])}
				<div class="field">
					<label for={id('occurrenceCount')}>Number of lessons</label>
					<input
						id={id('occurrenceCount')}
						name="occurrenceCount"
						inputmode="numeric"
						value={v.occurrenceCount}
						aria-invalid={errs.occurrenceCount ? 'true' : undefined}
						aria-describedby="{id('occurrenceCount')}-hint{errs.occurrenceCount
							? ` ${id('occurrenceCount')}-error`
							: ''}"
					/>
					<p class="hint" id="{id('occurrenceCount')}-hint">
						When it ends after a number of lessons.
					</p>
					{#if errs.occurrenceCount}
						<p class="error" id="{id('occurrenceCount')}-error">{errs.occurrenceCount}</p>
					{/if}
				</div>
				<div class="field">
					<label for={id('endsOn')}>End date</label>
					<input
						id={id('endsOn')}
						name="endsOn"
						type="date"
						min={data.today}
						value={v.endsOn}
						aria-invalid={errs.endsOn ? 'true' : undefined}
						aria-describedby="{id('endsOn')}-hint{errs.endsOn ? ` ${id('endsOn')}-error` : ''}"
					/>
					<p class="hint" id="{id('endsOn')}-hint">When it ends on a date.</p>
					{#if errs.endsOn}
						<p class="error" id="{id('endsOn')}-error">{errs.endsOn}</p>
					{/if}
				</div>
			</div>
			<div class="field">
				<label for={id('note')}>Note (shown to the family)</label>
				<textarea
					id={id('note')}
					name="note"
					rows="2"
					aria-invalid={errs.note ? 'true' : undefined}
					aria-describedby={errs.note ? `${id('note')}-error` : undefined}>{v.note}</textarea
				>
				{#if errs.note}
					<p class="error" id="{id('note')}-error">{errs.note}</p>
				{/if}
			</div>
			<button class="button secondary" type="submit">Preview dates</button>
		</form>

		{#if previewed?.target === studentId}
			{@const p = previewed.preview}
			<div class="preview">
				<p>
					<strong>{p.scheduleLabel}</strong> · {p.lessonTypeName} · {p.priceLabel} per lesson ·
					{p.endLabel}
				</p>
				<ul class="dates">
					{#each p.dates as d (d.date)}
						<li class={d.status === 'ok' ? '' : 'skip'}>
							<span>{d.whenLabel}</span>
							<span class="badge {d.status === 'ok' ? 'ok' : ''}">{d.statusLabel}</span>
						</li>
					{/each}
				</ul>
				{#if p.continues}
					<p class="hint">
						Later dates are added automatically each day, up to 12 weeks ahead. Any that clash then
						are skipped.
					</p>
				{/if}
				{#if p.bookable === 0}
					<p class="banner bad" role="alert">None of these dates can be booked.</p>
				{:else}
					<p>
						{p.bookable}
						{p.bookable === 1 ? 'lesson' : 'lessons'} will be booked and confirmed{p.dates.length >
						p.bookable
							? `; ${p.dates.length - p.bookable} skipped`
							: ''}. {studentName}'s family gets one email with every date.
					</p>
					<form method="POST" action="?/seriesCreate" use:enhance>
						<input type="hidden" name="studentId" value={studentId} />
						{#each Object.entries(previewed.values) as [name, value] (name)}
							{#if name !== 'studentId'}
								<input type="hidden" {name} {value} />
							{/if}
						{/each}
						<button class="button" type="submit">
							Book {p.bookable}
							{p.bookable === 1 ? 'lesson' : 'lessons'}
						</button>
					</form>
				{/if}
			</div>
		{/if}
	</details>
{/snippet}

{#snippet select(
	selectId: string,
	name: string,
	label: string,
	value: string,
	errs: Record<string, string>,
	options: [string, string][]
)}
	<div class="field">
		<label for={selectId}>{label}</label>
		<select
			id={selectId}
			{name}
			aria-invalid={errs[name] ? 'true' : undefined}
			aria-describedby={errs[name] ? `${selectId}-error` : undefined}
		>
			{#each options as [optionValue, optionLabel] (optionValue)}
				<option value={optionValue} selected={optionValue === value}>{optionLabel}</option>
			{/each}
		</select>
		{#if errs[name]}
			<p class="error" id="{selectId}-error">{errs[name]}</p>
		{/if}
	</div>
{/snippet}

{#if data.family.students.length === 0}
	<p class="card empty">No students yet.</p>
{/if}

{#if !data.family.deleted}
	{@const errs = errorsFor('new', 'student')}
	<section class="card">
		<h2>Add a student</h2>
		{#if wasSaved('new', 'student')}
			<p class="banner" role="status">Student added.</p>
		{/if}
		{#if errs.form}
			<p class="banner bad" role="alert">{errs.form}</p>
		{/if}
		<form method="POST" action="?/addStudent" novalidate use:enhance>
			<div class="field">
				<label for="new-student-name">Student's name</label>
				<input
					id="new-student-name"
					name="name"
					autocomplete="off"
					value={newStudentName}
					aria-invalid={errs.name ? 'true' : undefined}
					aria-describedby={errs.name ? 'new-student-name-error' : undefined}
				/>
				{#if errs.name}
					<p class="error" id="new-student-name-error">{errs.name}</p>
				{/if}
			</div>
			<button class="button secondary" type="submit">Add student</button>
		</form>
	</section>
{/if}

<style>
	h3 {
		font-size: 1rem;
		margin: 1.25rem 0 0.5rem;
	}

	table {
		width: 100%;
		border-collapse: collapse;
	}

	th,
	td {
		padding: 0.4rem 0.5rem 0.4rem 0;
		text-align: left;
		vertical-align: top;
	}

	tbody th {
		font-weight: 600;
	}

	.series {
		margin: 0 0 0.75rem;
		padding-left: 1.25rem;
	}

	details {
		margin-top: 0.5rem;
	}

	summary {
		cursor: pointer;
		font-weight: 600;
		min-height: var(--tap);
		display: flex;
		align-items: center;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
		gap: 0 1rem;
	}

	.preview {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}

	.dates {
		margin: 0 0 1rem;
		padding: 0;
		list-style: none;
	}

	.dates li {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 0.25rem 0.75rem;
		padding: 0.4rem 0;
		border-bottom: 1px solid var(--border);
	}

	.dates li.skip span:first-child {
		text-decoration: line-through;
		color: var(--muted);
	}

	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>
