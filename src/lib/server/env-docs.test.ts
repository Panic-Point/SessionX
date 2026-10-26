import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

/** Keys of the object passed to `defineEnvVars(...)` in src/env.ts. */
function declaredEnvVars(): string[] {
	const source = read('src/env.ts');
	const start = source.indexOf('defineEnvVars({');
	if (start === -1) throw new Error('defineEnvVars call not found in src/env.ts');
	const open = source.indexOf('{', start);
	let depth = 0;
	let end = open;
	for (let i = open; i < source.length; i++) {
		if (source[i] === '{') depth++;
		else if (source[i] === '}' && --depth === 0) {
			end = i;
			break;
		}
	}
	const body = source.slice(open + 1, end);
	// Top-level keys only: depth 0 inside the body.
	const keys: string[] = [];
	let d = 0;
	for (const line of body.split('\n')) {
		const m = d === 0 ? /^\s*([A-Z][A-Z0-9_]*)\s*:/.exec(line) : null;
		if (m) keys.push(m[1]);
		for (const ch of line) {
			if (ch === '{') d++;
			else if (ch === '}') d--;
		}
	}
	return keys;
}

describe('env documentation', () => {
	const vars = declaredEnvVars();

	it('finds the declared variables', () => {
		expect(vars).toContain('SESSION_SECRET');
		expect(vars.length).toBeGreaterThan(5);
	});

	it.each(['docs/deploy.md', '.env.local.example'])('documents every variable in %s', (file) => {
		const text = read(file);
		const missing = vars.filter((name) => !text.includes(name));
		expect(missing).toEqual([]);
	});
});
