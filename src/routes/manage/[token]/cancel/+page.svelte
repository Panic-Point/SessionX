<script lang="ts">
	import { page } from '$app/state';
	import CancelLesson from '#lib/components/CancelLesson.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Cancel lesson · Brenda Sings</title>
	<meta name="robots" content="noindex" />
	<!-- same-origin, not no-referrer: the token must not leak to other sites, but no-referrer
		makes the browser send `Origin: null` on later form posts, which SvelteKit rejects. -->
	<meta name="referrer" content="same-origin" />
</svelte:head>

<CancelLesson
	lesson={data.lesson}
	backHref="/manage/{encodeURIComponent(page.params.token ?? '')}"
	message={form?.message}
/>
