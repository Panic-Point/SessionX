<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const statusLabels = {
		pending: 'Pending approval',
		approved: 'Approved',
		declined: 'Declined',
		cancelled: 'Cancelled',
		expired: 'Expired'
	} as const;
</script>

<svelte:head>
	<title>Your lesson · SessionX</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main>
	<div class="card">
		<span class="badge {data.status}">{statusLabels[data.status]}</span>
		<h1>{data.lessonTypeName}</h1>

		<dl>
			<div>
				<dt>Student</dt>
				<dd>{data.studentName}</dd>
			</div>
			<div>
				<dt>Time</dt>
				<dd>{data.whenLabel}</dd>
			</div>
			<div>
				<dt>Price</dt>
				<dd>{data.priceLabel}</dd>
			</div>
			{#if data.note}
				<div>
					<dt>Note</dt>
					<dd>{data.note}</dd>
				</div>
			{/if}
		</dl>

		{#if data.status === 'pending'}
			<p class="next">You'll get an email when it's approved.</p>
		{/if}
	</div>

	<a class="secondary" href="/book">Book another lesson</a>
</main>

<style>
	main {
		max-width: 520px;
		margin: 1rem auto 0;
	}

	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1.5rem 1.25rem;
	}

	.badge {
		display: inline-block;
		padding: 0.25rem 0.75rem;
		border-radius: 999px;
		font-size: 0.875rem;
		font-weight: 600;
	}

	.pending {
		background: #fff4e5;
		color: #8a4b00;
	}

	.approved {
		background: #e7f6ec;
		color: #146c2e;
	}

	.declined,
	.cancelled,
	.expired {
		background: #eef0f3;
		color: var(--muted);
	}

	h1 {
		font-size: 1.4rem;
		margin: 0.75rem 0 1rem;
	}

	dl {
		margin: 0;
		display: grid;
		gap: 0.75rem;
	}

	dt {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	dd {
		margin: 0.1rem 0 0;
		white-space: pre-line;
	}

	.next {
		margin: 1.25rem 0 0;
		color: var(--muted);
	}

	.secondary {
		display: inline-flex;
		align-items: center;
		min-height: var(--tap);
		margin-top: 0.75rem;
		font-weight: 600;
	}
</style>
