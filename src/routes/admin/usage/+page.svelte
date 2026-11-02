<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const r = $derived(data.report);

	const areas = ['Booking', 'Account', 'Sign-in', 'Other'] as const;
	const unused = $derived(r.features.filter((f) => f.views === 0));

	function barHeight(value: number, max: number): string {
		return max > 0 ? `${Math.max((value / max) * 100, value > 0 ? 4 : 0)}%` : '0%';
	}
	const pctLabel = (p: number | null) => (p === null ? '–' : `${p}%`);
</script>

<svelte:head>
	<title>Usage · Admin · Brenda Sings</title>
</svelte:head>

<h1>Usage</h1>

<nav class="periods" aria-label="Period">
	{#each [7, 30, 90] as d (d)}
		<a href="?days={d}" aria-current={r.days === d ? 'page' : undefined}>Last {d} days</a>
	{/each}
</nav>
<p class="meta period">{r.periodLabel}</p>

{#if r.tracking.lastEventLabel === null}
	<p class="banner bad" role="alert">
		No usage has been recorded yet. If families have visited since this was deployed, check that the
		usage_events database migration ran and look for "usage:" errors in the Cloudflare logs.
	</p>
{:else if r.tracking.stale}
	<p class="banner bad" role="alert">
		Nothing has been recorded since {r.tracking.lastEventLabel}. If the site has had visitors since
		then, tracking may have stopped: look for "usage:" errors in the Cloudflare logs.
	</p>
{/if}
{#if r.tracking.truncated}
	<p class="banner bad" role="alert">
		There were too many events to read them all, so these numbers are incomplete. Try a shorter
		period.
	</p>
{/if}

<section class="tiles" aria-label="Summary">
	{@render tile('Active families today', String(r.summary.dauToday))}
	{@render tile('Avg. active families a day', String(r.summary.avgDau))}
	{@render tile('Active families, last 30 days', String(r.summary.mau))}
	{@render tile(
		'Stickiness',
		pctLabel(r.summary.stickinessPct),
		'Average daily ÷ monthly active families. Higher means families come back more often.'
	)}
	{@render tile(
		'Visits',
		String(r.summary.visits),
		`${r.summary.signedInVisits} signed in, ${r.summary.guestVisits} as guests`
	)}
	{@render tile('Avg. time per visit', r.summary.avgVisitLabel)}
</section>

<section class="card">
	<h2>Active families per day</h2>
	{@render dailyChart('families', r.maxDailyFamilies, 'active families')}
	<h2 class="second">Visits per day</h2>
	{@render dailyChart('visits', r.maxDailyVisits, 'visits')}
	<details>
		<summary>Show as a table</summary>
		<table>
			<thead
				><tr><th>Day</th><th class="num">Active families</th><th class="num">Visits</th></tr></thead
			>
			<tbody>
				{#each r.daily as d (d.date)}
					<tr><td>{d.label}</td><td class="num">{d.families}</td><td class="num">{d.visits}</td></tr
					>
				{/each}
			</tbody>
		</table>
	</details>
</section>

<section class="card">
	<h2>Sign-ins</h2>
	<dl class="facts">
		<div>
			<dt>Successful sign-ins</dt>
			<dd>{r.signIns.succeeded}</dd>
		</div>
		<div>
			<dt>Wrong email or password</dt>
			<dd>{r.signIns.failed}</dd>
		</div>
		<div>
			<dt>Success rate</dt>
			<dd>{pctLabel(r.signIns.successPct)}</dd>
		</div>
		<div>
			<dt>Families active in this period</dt>
			<dd>
				{r.signIns.familiesActive} of {r.signIns.familiesTotal}
				<span class="meta">({pctLabel(r.signIns.activePct)})</span>
			</dd>
		</div>
	</dl>
	<p class="hint">
		Families stay signed in for a while, so active families can be higher than sign-ins.
	</p>
</section>

<section class="card">
	<h2>Where time is spent</h2>
	{#if r.pages.length === 0}
		<p class="empty">No page views in this period.</p>
	{:else}
		<div class="scroll">
			<table>
				<thead>
					<tr>
						<th>Page</th>
						<th class="num">Views</th>
						<th class="num">Total time</th>
						<th class="num">Avg. per view</th>
					</tr>
				</thead>
				<tbody>
					{#each r.pages as p (p.route)}
						<tr>
							<td>
								{p.label}
								<span class="bar" style:width="{p.barPct}%" aria-hidden="true"></span>
							</td>
							<td class="num">{p.views}</td>
							<td class="num">{p.totalLabel}</td>
							<td class="num">{p.avgLabel}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

<section class="card">
	<h2>Booking steps</h2>
	<p class="hint">
		Visits that reached each step of booking a lesson as a guest. A big drop between two steps is
		where people get stuck or give up.
	</p>
	<ol class="funnel">
		{#each r.funnel as step, i (step.route)}
			<li>
				<div class="funnel-label">
					<span>{step.label}</span>
					<span class="num">
						{step.visits}
						{#if i > 0}<span class="meta">({pctLabel(step.pctOfPrev)} of the step before)</span
							>{/if}
					</span>
				</div>
				<span class="track"><span class="fill" style:width="{step.pctOfFirst ?? 0}%"></span></span>
			</li>
		{/each}
	</ol>
</section>

<section class="card">
	<h2>Features used</h2>
	{#if unused.length > 0}
		<p class="hint">
			Not opened in this period: {unused.map((f) => f.label).join(', ')}.
		</p>
	{/if}
	<div class="areas">
		{#each areas as area (area)}
			<div>
				<h3>{area}</h3>
				<ul class="features">
					{#each r.features.filter((f) => f.area === area) as f (f.route)}
						<li>
							<span>{f.label}</span>
							{#if f.views === 0}
								<span class="badge">Not used</span>
							{:else}
								<span class="num">{f.views} {f.views === 1 ? 'view' : 'views'}</span>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</div>
</section>

<section class="card">
	<h2>Families</h2>
	{#if r.families.length === 0}
		<p class="empty">No families yet.</p>
	{:else}
		<div class="scroll">
			<table>
				<thead>
					<tr>
						<th>Family</th>
						<th>Last active</th>
						<th class="num">Days active</th>
						<th class="num">Sign-ins</th>
						<th class="num">Page views</th>
						<th class="num">Time</th>
					</tr>
				</thead>
				<tbody>
					{#each r.families as f (f.id)}
						<tr>
							<td><a href="/admin/families/{f.id}">{f.name}</a></td>
							<td>{f.lastActiveLabel ?? 'Not recently'}</td>
							<td class="num">{f.activeDays}</td>
							<td class="num">{f.signIns}</td>
							<td class="num">{f.views}</td>
							<td class="num">{f.timeLabel}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="hint">"Last active" looks back up to 90 days.</p>
	{/if}
</section>

<section class="card">
	<h2>Errors</h2>
	{#if r.errors.length === 0}
		<p class="empty">No server errors in this period.</p>
	{:else}
		<div class="scroll">
			<table>
				<thead>
					<tr><th>Page</th><th class="num">Errors</th><th>Last</th></tr>
				</thead>
				<tbody>
					{#each r.errors as e (e.route)}
						<tr>
							<td>{e.label}</td>
							<td class="num">{e.count}</td>
							<td>{e.lastLabel}<span class="meta detail">{e.lastDetail}</span></td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

<p class="hint privacy">
	{#if r.tracking.lastEventLabel}Last event recorded {r.tracking.lastEventLabel}.{/if}
	Collected by this site only: no third-party trackers or cookies. Guests are counted by a random id kept
	for one browser tab; no IP addresses, emails or full web addresses are stored. Your own use while signed
	in as admin is not counted. Events are deleted after 400 days, and when a family deletes their account.
</p>

{#snippet tile(label: string, value: string, hint = '')}
	<div class="tile">
		<p class="tile-label">{label}</p>
		<p class="tile-value">{value}</p>
		{#if hint}<p class="hint">{hint}</p>{/if}
	</div>
{/snippet}

{#snippet dailyChart(key: 'families' | 'visits', max: number, unit: string)}
	<div class="chart" role="img" aria-label="{unit} per day; see the table below">
		<span class="axis-max meta" aria-hidden="true">{max}</span>
		<div class="bars" class:dense={r.days > 30}>
			{#each r.daily as d (d.date)}
				<div class="col" title="{d.label}: {d[key]} {unit}">
					<span class="bar-v" style:height={barHeight(d[key], max)}></span>
				</div>
			{/each}
		</div>
		<div class="x meta" aria-hidden="true">
			<span>{r.daily[0]?.label}</span><span>{r.daily[r.daily.length - 1]?.label}</span>
		</div>
	</div>
{/snippet}

<style>
	.periods {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.periods a {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
		padding: 0 0.85rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
		color: var(--text);
		font-weight: 600;
		text-decoration: none;
	}

	.periods a[aria-current='page'] {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--accent-soft);
	}

	.period {
		margin-bottom: 1rem;
	}

	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 0.75rem;
		margin-bottom: 1rem;
	}

	.tile {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 0.9rem 1rem;
	}

	.tile-label {
		margin: 0;
		font-size: 0.875rem;
		color: var(--muted);
	}

	.tile-value {
		margin: 0.25rem 0 0;
		font-size: 1.75rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	h2.second {
		margin-top: 1.5rem;
	}

	h3 {
		font-size: 0.95rem;
		margin: 0 0 0.5rem;
	}

	.chart {
		position: relative;
	}

	.axis-max {
		font-size: 0.75rem;
	}

	.bars {
		display: flex;
		align-items: flex-end;
		gap: 2px;
		height: 120px;
		border-bottom: 1px solid var(--border);
	}

	.col {
		flex: 1;
		height: 100%;
		display: flex;
		align-items: flex-end;
	}

	.col:hover .bar-v {
		background: var(--accent-hover);
	}

	.bar-v {
		display: block;
		width: 100%;
		background: var(--accent);
		border-radius: 4px 4px 0 0;
	}

	.dense .bar-v {
		border-radius: 2px 2px 0 0;
	}

	.x {
		display: flex;
		justify-content: space-between;
		font-size: 0.75rem;
	}

	details {
		margin-top: 1rem;
	}

	summary {
		cursor: pointer;
		font-weight: 600;
		min-height: var(--tap);
		display: flex;
		align-items: center;
	}

	.scroll {
		overflow-x: auto;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.95rem;
	}

	th,
	td {
		text-align: left;
		padding: 0.5rem 0.5rem 0.5rem 0;
		border-bottom: 1px solid var(--border);
		vertical-align: top;
	}

	th {
		font-size: 0.85rem;
		color: var(--muted);
		font-weight: 600;
	}

	.num {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	td .bar {
		display: block;
		height: 4px;
		margin-top: 0.3rem;
		border-radius: 2px;
		background: var(--accent);
		opacity: 0.6;
	}

	.facts {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 0.75rem;
		margin: 0;
	}

	.facts dt {
		font-size: 0.875rem;
		color: var(--muted);
	}

	.facts dd {
		margin: 0.15rem 0 0;
		font-size: 1.25rem;
		font-weight: 700;
	}

	.funnel {
		list-style: none;
		margin: 1rem 0 0;
		padding: 0;
	}

	.funnel li {
		margin-bottom: 0.9rem;
	}

	.funnel-label {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-bottom: 0.25rem;
	}

	.track {
		display: block;
		height: 12px;
		border-radius: 4px;
		background: var(--accent-soft);
	}

	.fill {
		display: block;
		height: 100%;
		border-radius: 4px;
		background: var(--accent);
	}

	.areas {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 1rem;
		margin-top: 0.75rem;
	}

	.features {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.features li {
		display: flex;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.35rem 0;
		border-bottom: 1px solid var(--border);
	}

	.detail {
		display: block;
		font-size: 0.85rem;
		overflow-wrap: anywhere;
	}

	.privacy {
		margin-top: 1rem;
	}
</style>
