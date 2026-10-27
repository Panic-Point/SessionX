<script lang="ts">
	import { loadTurnstile, type TurnstileApi } from '#lib/turnstile-client.ts';

	let { sitekey }: { sitekey: string } = $props();

	let el = $state<HTMLElement>();
	let api: TurnstileApi | undefined;
	let widgetId: string | undefined;

	/** A Turnstile token is single-use; call after each submit to get a fresh one for any retry. */
	export function reset(): void {
		if (widgetId !== undefined) api?.reset(widgetId);
	}

	// Explicit render: the script is injected programmatically so it also works after client-side
	// navigation, where scripts in <svelte:head> may not execute.
	$effect(() => {
		const key = sitekey;
		const container = el;
		if (!key || !container) return;
		let cancelled = false;
		loadTurnstile()
			.then((loaded) => {
				if (cancelled) return;
				api = loaded;
				widgetId = loaded.render(container, { sitekey: key });
			})
			.catch((e) => console.error('Turnstile failed to load', e));
		return () => {
			cancelled = true;
			if (widgetId !== undefined) api?.remove(widgetId);
			widgetId = undefined;
		};
	});
</script>

<div class="cf-turnstile" bind:this={el}></div>

<style>
	.cf-turnstile {
		margin-bottom: 1rem;
	}
</style>
