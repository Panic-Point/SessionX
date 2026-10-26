// Generates the app icons in static/icons/ as PNGs. Pure Node (zlib + a CRC32 table), no deps.
// Run once with `node scripts/generate-icons.mjs` and commit the output.
//
// The mark is a white calendar on the accent blue (--accent in src/routes/+layout.svelte).
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const ACCENT = [0x0b, 0x6b, 0xcb];
const ACCENT_DARK = [0x09, 0x57, 0xa6];
const ACCENT_SOFT = [0xb9, 0xd3, 0xf0];
const WHITE = [0xff, 0xff, 0xff];

// ---------- PNG encoding ----------

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function crc32(buf) {
	let c = 0xffffffff;
	for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([len, body, crc]);
}

/** @param {number} size @param {Uint8Array} rgba */
function encodePng(size, rgba) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // colour type: RGBA
	const stride = size * 4;
	const raw = Buffer.alloc((stride + 1) * size);
	for (let y = 0; y < size; y++) {
		raw[y * (stride + 1)] = 0; // filter: none
		Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

// ---------- Drawing ----------

/** Inside a rounded rectangle (all coordinates in 0..1 units). */
function inRoundRect(x, y, x0, y0, x1, y1, r) {
	if (x < x0 || x > x1 || y < y0 || y > y1) return false;
	const cx = Math.min(Math.max(x, x0 + r), x1 - r);
	const cy = Math.min(Math.max(y, y0 + r), y1 - r);
	return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/** Colour of the calendar glyph at (u, v) in its own 0..1 box, or null if transparent. */
function glyph(u, v) {
	// Binder rings sit above the page.
	if (inRoundRect(u, v, 0.27, 0.08, 0.35, 0.28, 0.04)) return WHITE;
	if (inRoundRect(u, v, 0.65, 0.08, 0.73, 0.28, 0.04)) return WHITE;
	if (!inRoundRect(u, v, 0.1, 0.18, 0.9, 0.9, 0.09)) return null;
	if (v < 0.37) return ACCENT_DARK; // header band
	// A 3x2 grid of days; one is "booked".
	for (const [row, cy] of [0.53, 0.73].entries()) {
		for (const [col, cx] of [0.3, 0.5, 0.7].entries()) {
			if (inRoundRect(u, v, cx - 0.065, cy - 0.065, cx + 0.065, cy + 0.065, 0.025)) {
				return row === 0 && col === 1 ? ACCENT : ACCENT_SOFT;
			}
		}
	}
	return WHITE;
}

/**
 * @param {number} size output pixels
 * @param {{ glyphBox: number; bgRadius: number }} opts glyph box side and background corner
 *   radius, both as a fraction of the canvas. bgRadius 0 gives an opaque full-bleed square.
 */
function render(size, { glyphBox, bgRadius }) {
	const rgba = new Uint8Array(size * size * 4);
	const SS = 4; // 4x4 supersampling for smooth edges
	const g0 = (1 - glyphBox) / 2;
	for (let py = 0; py < size; py++) {
		for (let px = 0; px < size; px++) {
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 0;
			for (let sy = 0; sy < SS; sy++) {
				for (let sx = 0; sx < SS; sx++) {
					const x = (px + (sx + 0.5) / SS) / size;
					const y = (py + (sy + 0.5) / SS) / size;
					if (bgRadius > 0 && !inRoundRect(x, y, 0, 0, 1, 1, bgRadius)) continue;
					const colour = glyph((x - g0) / glyphBox, (y - g0) / glyphBox) ?? ACCENT;
					r += colour[0];
					g += colour[1];
					b += colour[2];
					a += 1;
				}
			}
			const i = (py * size + px) * 4;
			if (a > 0) {
				rgba[i] = Math.round(r / a);
				rgba[i + 1] = Math.round(g / a);
				rgba[i + 2] = Math.round(b / a);
			}
			rgba[i + 3] = Math.round((a / (SS * SS)) * 255);
		}
	}
	return encodePng(size, rgba);
}

// ---------- Output ----------

const outDir = new URL('../static/icons/', import.meta.url);
mkdirSync(outDir, { recursive: true });

const icons = [
	// "any" icons: rounded tile, glyph fills most of it.
	['icon-192.png', 192, { glyphBox: 0.72, bgRadius: 0.22 }],
	['icon-512.png', 512, { glyphBox: 0.72, bgRadius: 0.22 }],
	// Maskable: full bleed; the glyph's corners stay inside the central 80% safe circle
	// (content spans 0.8 x 0.66 = 0.53 of the canvas; half-diagonal 0.37 < 0.40).
	['icon-maskable-512.png', 512, { glyphBox: 0.66, bgRadius: 0 }],
	// iOS shows transparency as black and rounds corners itself, so stay opaque and square.
	['apple-touch-icon.png', 180, { glyphBox: 0.72, bgRadius: 0 }]
];

for (const [name, size, opts] of icons) {
	const png = render(size, opts);
	writeFileSync(new URL(name, outDir), png);
	console.log(`static/icons/${name} ${size}x${size} ${png.length} bytes`);
}
