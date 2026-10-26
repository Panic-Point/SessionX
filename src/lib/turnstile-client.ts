// Client-side Turnstile loader. Safe to import during SSR: document/window are only touched when
// loadTurnstile is called (from the browser).
export interface TurnstileApi {
	render(container: HTMLElement | string, options: { sitekey: string }): string;
	reset(widgetId?: string): void;
	remove(widgetId?: string): void;
}

const SCRIPT_ID = 'cf-turnstile-script';
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type Win = { turnstile?: TurnstileApi };

let pending: Promise<TurnstileApi> | undefined;

/** Loads the Turnstile script once and resolves with its API. Idempotent; the promise is shared. */
export function loadTurnstile(
	doc: Document = document,
	win: Win = window as unknown as Win
): Promise<TurnstileApi> {
	if (win.turnstile) return Promise.resolve(win.turnstile);
	if (pending) return pending;
	pending = new Promise<TurnstileApi>((resolve, reject) => {
		const fail = () => {
			pending = undefined;
			doc.getElementById(SCRIPT_ID)?.remove?.();
			reject(new Error('Could not load Turnstile'));
		};
		const done = () => (win.turnstile ? resolve(win.turnstile) : fail());
		let script = doc.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
		if (!script) {
			script = doc.createElement('script');
			script.id = SCRIPT_ID;
			script.src = SCRIPT_SRC;
			script.async = true;
			script.defer = true;
			script.addEventListener('load', done);
			script.addEventListener('error', fail);
			doc.head.appendChild(script);
		} else {
			script.addEventListener('load', done);
			script.addEventListener('error', fail);
		}
	});
	return pending;
}

/** Test helper: forget the shared promise. */
export function resetTurnstileLoader(): void {
	pending = undefined;
}
