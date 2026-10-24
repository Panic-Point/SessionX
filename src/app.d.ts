// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { Account } from '#lib/server/store/types.ts';

declare global {
	namespace App {
		interface Platform {
			env: Env;
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf?: IncomingRequestCfProperties;
		}

		// interface Error {}
		interface Locals {
			/** The signed-in account, from a valid session cookie; null when signed out. */
			account: Account | null;
		}
		// interface PageData {}
		// interface PageState {}
	}
}

export {};
