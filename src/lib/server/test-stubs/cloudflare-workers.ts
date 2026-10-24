// Vitest stand-in for the `cloudflare:workers` module, which only exists in the Workers runtime.
export function waitUntil(_task: Promise<unknown>): void {}
