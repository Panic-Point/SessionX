import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTurnstile, resetTurnstileLoader, type TurnstileApi } from './turnstile-client.ts';

type Listener = () => void;

function fakeEnv() {
	const scripts: Array<{
		id: string;
		src: string;
		async: boolean;
		defer: boolean;
		listeners: Record<string, Listener[]>;
		addEventListener: (type: string, fn: Listener) => void;
	}> = [];
	const doc = {
		getElementById: (id: string) => scripts.find((s) => s.id === id) ?? null,
		createElement: () => {
			const s = {
				id: '',
				src: '',
				async: false,
				defer: false,
				listeners: {} as Record<string, Listener[]>,
				addEventListener(type: string, fn: Listener) {
					(s.listeners[type] ??= []).push(fn);
				}
			};
			return s;
		},
		head: { appendChild: (s: (typeof scripts)[number]) => void scripts.push(s) }
	};
	const win: { turnstile?: TurnstileApi } = {};
	const api: TurnstileApi = { render: vi.fn(), reset: vi.fn(), remove: vi.fn() };
	return { scripts, doc, win, api };
}

describe('loadTurnstile', () => {
	beforeEach(() => resetTurnstileLoader());

	it('returns immediately when window.turnstile already exists', async () => {
		const { doc, win, api, scripts } = fakeEnv();
		win.turnstile = api;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await expect(loadTurnstile(doc as any, win as any)).resolves.toBe(api);
		expect(scripts).toHaveLength(0);
	});

	it('injects the explicit-render script once across two calls', async () => {
		const { doc, win, api, scripts } = fakeEnv();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const a = loadTurnstile(doc as any, win as any);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const b = loadTurnstile(doc as any, win as any);
		expect(scripts).toHaveLength(1);
		expect(scripts[0].src).toBe(
			'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
		);
		expect(scripts[0].async).toBe(true);
		win.turnstile = api;
		scripts[0].listeners.load.forEach((fn) => fn());
		expect(await a).toBe(api);
		expect(await b).toBe(api);
	});

	it('resolves with window.turnstile after the script load event', async () => {
		const { doc, win, api, scripts } = fakeEnv();
		let settled = false;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const p = loadTurnstile(doc as any, win as any).then((t) => {
			settled = true;
			return t;
		});
		await Promise.resolve();
		expect(settled).toBe(false);
		win.turnstile = api;
		scripts[0].listeners.load.forEach((fn) => fn());
		expect(await p).toBe(api);
	});

	it('rejects and allows a retry when the script fails to load', async () => {
		const { doc, win, scripts } = fakeEnv();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const p = loadTurnstile(doc as any, win as any);
		scripts[0].listeners.error.forEach((fn) => fn());
		await expect(p).rejects.toThrow();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		void loadTurnstile(doc as any, win as any).catch(() => {});
		expect(scripts.length).toBeGreaterThanOrEqual(1);
	});
});
