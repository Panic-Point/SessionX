<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let submitting = $state(false);
	let checking = $state(false);

	const values = $derived(form?.values ?? data.values);
	const errors: Partial<Record<string, string>> = $derived(form?.errors ?? {});
	const check = $derived(form?.check);

	const US_ZONES = [
		'America/New_York',
		'America/Chicago',
		'America/Denver',
		'America/Phoenix',
		'America/Los_Angeles',
		'America/Anchorage',
		'Pacific/Honolulu'
	];
	const INCREMENTS = [5, 10, 15, 20, 30, 60];

	function describedBy(name: string, hint: boolean): string | undefined {
		const ids = [hint ? `${name}-hint` : '', errors[name] ? `${name}-error` : '']
			.filter(Boolean)
			.join(' ');
		return ids || undefined;
	}
</script>

<svelte:head>
	<title>Settings · Admin · SessionX</title>
</svelte:head>

<h1>Settings</h1>

{#if form?.saved}
	<p class="banner" role="status">Settings saved.</p>
{:else if form?.saved === false}
	<p class="banner bad" role="alert">Please fix the highlighted fields.</p>
{/if}

{#snippet numberField(name: keyof typeof values, label: string, hint: string)}
	<div class="field">
		<label for={name}>{label}</label>
		<input
			id={name}
			{name}
			type="number"
			inputmode="numeric"
			value={values[name]}
			aria-invalid={errors[name] ? 'true' : undefined}
			aria-describedby={describedBy(name, true)}
		/>
		<p class="hint" id="{name}-hint">{hint}</p>
		{#if errors[name]}
			<p class="error" id="{name}-error">{errors[name]}</p>
		{/if}
	</div>
{/snippet}

<form
	class="card"
	method="POST"
	action="?/save"
	novalidate
	use:enhance={() => {
		submitting = true;
		return async ({ update }) => {
			await update({ reset: false });
			submitting = false;
		};
	}}
>
	<div class="field">
		<label for="timezone">Studio time zone</label>
		<input
			id="timezone"
			name="timezone"
			list="timezone-options"
			autocomplete="off"
			value={values.timezone}
			aria-invalid={errors.timezone ? 'true' : undefined}
			aria-describedby={describedBy('timezone', true)}
		/>
		<datalist id="timezone-options">
			{#each US_ZONES as zone (zone)}
				<option value={zone}></option>
			{/each}
		</datalist>
		<p class="hint" id="timezone-hint">An IANA zone name, like America/New_York.</p>
		{#if errors.timezone}
			<p class="error" id="timezone-error">{errors.timezone}</p>
		{/if}
	</div>

	{@render numberField(
		'minNoticeHours',
		'Minimum notice (hours)',
		'How far ahead a lesson must be requested.'
	)}
	{@render numberField(
		'maxAdvanceDays',
		'Booking window (days)',
		'How many days ahead people can book.'
	)}

	<div class="field">
		<label for="slotIncrementMin">Start times every</label>
		<select
			id="slotIncrementMin"
			name="slotIncrementMin"
			value={values.slotIncrementMin}
			aria-invalid={errors.slotIncrementMin ? 'true' : undefined}
			aria-describedby={describedBy('slotIncrementMin', false)}
		>
			{#each INCREMENTS as n (n)}
				<option value={String(n)}>{n} minutes</option>
			{/each}
		</select>
		{#if errors.slotIncrementMin}
			<p class="error" id="slotIncrementMin-error">{errors.slotIncrementMin}</p>
		{/if}
	</div>

	{@render numberField(
		'bufferMin',
		'Buffer between lessons (minutes)',
		'Kept free after each lesson.'
	)}

	<div class="field">
		<label class="check">
			<input type="checkbox" name="allowSameDay" checked={values.allowSameDay === 'on'} />
			Allow same-day bookings
		</label>
	</div>

	{@render numberField(
		'cancelCutoffHours',
		'Cancellation cutoff (hours)',
		'Cancelling later than this counts as a late cancel.'
	)}

	<div class="field">
		<label for="cancellationPolicyText">Cancellation policy</label>
		<textarea
			id="cancellationPolicyText"
			name="cancellationPolicyText"
			rows="4"
			maxlength="2000"
			value={values.cancellationPolicyText}
			aria-invalid={errors.cancellationPolicyText ? 'true' : undefined}
			aria-describedby={describedBy('cancellationPolicyText', false)}></textarea>
		{#if errors.cancellationPolicyText}
			<p class="error" id="cancellationPolicyText-error">{errors.cancellationPolicyText}</p>
		{/if}
	</div>

	<div class="field">
		<label for="adminEmail">Notification email <span class="optional">(optional)</span></label>
		<input
			id="adminEmail"
			name="adminEmail"
			type="email"
			autocomplete="email"
			value={values.adminEmail}
			aria-invalid={errors.adminEmail ? 'true' : undefined}
			aria-describedby={describedBy('adminEmail', true)}
		/>
		<p class="hint" id="adminEmail-hint">Where new booking requests are sent.</p>
		{#if errors.adminEmail}
			<p class="error" id="adminEmail-error">{errors.adminEmail}</p>
		{/if}
	</div>

	<fieldset class="calendar" aria-labelledby="calendar-heading">
		<h2 id="calendar-heading">Google Calendar</h2>
		{#if data.calendar.serviceAccountEmail}
			<p class="share">
				Share your calendars with: <strong>{data.calendar.serviceAccountEmail}</strong>
			</p>
		{:else if data.calendar.configError}
			<p class="banner bad" role="alert">
				Google Calendar is turned off because the server setting has a problem: {data.calendar
					.configError}. See docs/google-calendar.md.
			</p>
		{:else}
			<p class="hint not-configured">
				Google Calendar is not set up on the server yet, so these calendars are saved but not used.
				See docs/google-calendar.md to turn it on.
			</p>
		{/if}

		<div class="field">
			<label for="gcalWriteCalendarId">
				Lesson calendar <span class="optional">(optional)</span>
			</label>
			<input
				id="gcalWriteCalendarId"
				name="gcalWriteCalendarId"
				autocomplete="off"
				spellcheck="false"
				maxlength="254"
				value={values.gcalWriteCalendarId}
				aria-invalid={errors.gcalWriteCalendarId ? 'true' : undefined}
				aria-describedby={describedBy('gcalWriteCalendarId', true)}
			/>
			<p class="hint" id="gcalWriteCalendarId-hint">
				Approved lessons are added here. Use the calendar ID, usually an email address.
			</p>
			{#if errors.gcalWriteCalendarId}
				<p class="error" id="gcalWriteCalendarId-error">{errors.gcalWriteCalendarId}</p>
			{/if}
		</div>

		<div class="field">
			<label for="gcalBusyCalendarIds">
				Busy calendars <span class="optional">(optional)</span>
			</label>
			<textarea
				id="gcalBusyCalendarIds"
				name="gcalBusyCalendarIds"
				rows="3"
				spellcheck="false"
				value={values.gcalBusyCalendarIds}
				aria-invalid={errors.gcalBusyCalendarIds ? 'true' : undefined}
				aria-describedby={describedBy('gcalBusyCalendarIds', true)}></textarea>
			<p class="hint" id="gcalBusyCalendarIds-hint">
				Times that are busy on these calendars can't be booked. One calendar ID per line, up to 10.
			</p>
			{#if errors.gcalBusyCalendarIds}
				<p class="error" id="gcalBusyCalendarIds-error">{errors.gcalBusyCalendarIds}</p>
			{/if}
		</div>
	</fieldset>

	<button class="button" type="submit" disabled={submitting}>
		{submitting ? 'Saving…' : 'Save settings'}
	</button>
</form>

<form
	class="card"
	method="POST"
	action="?/checkConnection"
	aria-labelledby="check-heading"
	use:enhance={() => {
		checking = true;
		return async ({ update }) => {
			await update({ reset: false });
			checking = false;
		};
	}}
>
	<h2 id="check-heading">Check connection</h2>
	<p class="hint intro">Tries to read each saved calendar. Save any changes first.</p>
	{#if check}
		<div class={check.ok ? 'banner' : 'banner bad'} role={check.ok ? 'status' : 'alert'}>
			<ul class="lines">
				{#each check.lines as line, i (i)}
					<li>{line}</li>
				{/each}
			</ul>
		</div>
	{/if}
	<button class="button secondary" type="submit" disabled={checking}>
		{checking ? 'Checking…' : 'Check connection'}
	</button>
</form>

<style>
	form {
		max-width: 560px;
	}

	.calendar {
		margin: 0.5rem 0 1rem;
		padding: 1rem 0 0;
		border: 0;
		border-top: 1px solid var(--border);
		min-width: 0;
	}

	.share {
		margin: 0 0 1rem;
		overflow-wrap: anywhere;
	}

	.not-configured,
	.intro {
		margin: 0 0 1rem;
	}

	.lines {
		margin: 0;
		padding-left: 1.25rem;
		overflow-wrap: anywhere;
	}

	.optional {
		font-weight: 400;
		color: var(--muted);
	}
</style>
