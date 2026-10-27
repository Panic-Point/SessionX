import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const staticDir = new URL('../../static/', import.meta.url);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readPng(path: string) {
	const bytes = readFileSync(new URL(path, staticDir));
	return {
		signature: [...bytes.subarray(0, 8)],
		chunkType: bytes.subarray(12, 16).toString('ascii'),
		width: bytes.readUInt32BE(16),
		height: bytes.readUInt32BE(20)
	};
}

describe('generated icons', () => {
	it.each([
		['icons/icon-192.png', 192],
		['icons/icon-512.png', 512],
		['icons/icon-maskable-512.png', 512],
		['icons/apple-touch-icon.png', 180]
	])('%s is a %ipx square PNG', (path, size) => {
		const png = readPng(path);
		expect(png.signature).toEqual(PNG_SIGNATURE);
		expect(png.chunkType).toBe('IHDR');
		expect(png.width).toBe(size);
		expect(png.height).toBe(size);
	});
});

describe('manifest.webmanifest', () => {
	const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', staticDir), 'utf8'));

	it('describes a standalone app that starts on the home page', () => {
		expect(manifest.name).toBe('Brenda Sings');
		expect(manifest.short_name).toBeTruthy();
		expect(manifest.display).toBe('standalone');
		expect(manifest.start_url).toBe('/');
		expect(manifest.scope).toBe('/');
	});

	it('lists icons that exist with the sizes it claims', () => {
		const icons = manifest.icons as Array<{ src: string; sizes: string; purpose?: string }>;
		expect(icons.some((i) => i.sizes === '192x192')).toBe(true);
		expect(icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true);
		for (const icon of icons) {
			const png = readPng(icon.src.replace(/^\//, ''));
			expect(`${png.width}x${png.height}`).toBe(icon.sizes);
		}
	});
});
