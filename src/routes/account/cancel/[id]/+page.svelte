<script lang="ts">
	import CancelLesson from '#lib/components/CancelLesson.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Cancel lesson · SessionX</title>
</svelte:head>

<CancelLesson lesson={data.lesson} backHref="/account" message={form?.message} />
