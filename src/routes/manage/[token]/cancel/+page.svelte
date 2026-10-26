<script lang="ts">
	import { page } from '$app/state';
	import CancelLesson from '#lib/components/CancelLesson.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Cancel lesson · SessionX</title>
	<meta name="robots" content="noindex" />
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<CancelLesson
	lesson={data.lesson}
	backHref="/manage/{encodeURIComponent(page.params.token ?? '')}"
	message={form?.message}
/>
