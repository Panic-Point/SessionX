import { spawn } from 'node:child_process';

/**
 * Run a command; resolves with stdout (when captured) on exit code 0, rejects otherwise.
 * On Windows, npx/docker are .cmd shims, so the command goes through the shell as one string.
 */
export function run(cmd, args = [], { capture = false, quiet = false } = {}) {
	return new Promise((resolve, reject) => {
		const stdio = ['ignore', capture ? 'pipe' : 'inherit', quiet ? 'ignore' : 'inherit'];
		const child =
			process.platform === 'win32'
				? spawn([cmd, ...args].join(' '), { stdio, shell: true })
				: spawn(cmd, args, { stdio });
		let out = '';
		if (capture) child.stdout.on('data', (d) => (out += d));
		child.on('error', reject);
		child.on('exit', (code) =>
			code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}`))
		);
	});
}

/** Fail fast with a readable message when Docker isn't running. */
export async function requireDocker() {
	try {
		await run('docker', ['info'], { capture: true, quiet: true });
	} catch {
		console.error(
			'\nDocker is not running (or not installed). Install/start Docker Desktop and try again.\n'
		);
		process.exit(1);
	}
}
