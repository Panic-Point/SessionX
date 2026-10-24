import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		})
	],
	server: {
		// File events don't cross Docker Desktop's Windows bind mounts; poll inside the container.
		watch: { usePolling: process.env.VITE_USE_POLLING === 'true' }
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				resolve: {
					// `cloudflare:workers` only exists in the Workers runtime.
					alias: {
						'cloudflare:workers': fileURLToPath(
							new URL('./src/lib/server/test-stubs/cloudflare-workers.ts', import.meta.url)
						)
					}
				},
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
