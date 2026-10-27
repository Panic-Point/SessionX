// Generates the app icons in static/icons/ as PNGs. Pure Node (zlib + a CRC32 table), no deps.
// Run once with `node scripts/generate-icons.mjs` and commit the output.
//
// The mark is the Brenda Sings "BW" from src/lib/assets/favicon.svg: a white serif B and a coral
// sound-wave W on plum (--brand in src/routes/+layout.svelte). Keep the two in step.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const PLUM = [0x4a, 0x21, 0x60];
const CORAL = [0xf2, 0x69, 0x4f];
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

// The B outline in the favicon's 64-unit box (DM Serif Display, converted to M/L/Q/Z commands).
const B_PATH =
	'M17.14 47L5.97 47L5.97 46.56L6.76 46.25Q7.64 45.90 7.97 45.37Q8.30 44.84 8.30 43.96L8.30 43.96L8.30 21.00Q8.30 20.07 7.97 19.54Q7.64 19.02 6.76 18.71L6.76 18.71L5.97 18.40L5.97 17.96L18.60 17.96Q23.96 17.96 26.34 19.92Q28.72 21.88 28.72 24.87L28.72 24.87Q28.72 27.11 26.98 28.94Q25.24 30.76 21.02 31.51L21.02 31.51Q25.86 32.04 28.10 34.04Q30.34 36.04 30.34 38.90L30.34 38.90Q30.34 40.31 29.73 41.74Q29.11 43.17 27.64 44.36Q26.16 45.55 23.61 46.27Q21.06 47 17.14 47L17.14 47ZM14.81 18.84L14.81 31.47L16.70 31.47Q19.65 31.47 20.95 30.10Q22.25 28.74 22.25 25.35L22.25 25.35Q22.25 21.83 21.06 20.34Q19.87 18.84 17.19 18.84L17.19 18.84L14.81 18.84ZM14.81 32.35L14.81 46.12L17.01 46.12Q20.31 46.12 21.92 44.36Q23.52 42.60 23.52 38.86L23.52 38.86Q23.52 35.34 21.98 33.84Q20.44 32.35 16.92 32.35L16.92 32.35L14.81 32.35Z';

/** Flattens absolute M/L/Q/Z path data into closed polygons of [x, y] points. */
function toPolygons(d) {
	const polygons = [];
	let poly = [];
	let [x, y] = [0, 0];
	for (const [, cmd, args] of d.matchAll(/([MLQZ])([^MLQZ]*)/g)) {
		const n = args.trim()
			? args
					.trim()
					.split(/[\s,]+/)
					.map(Number)
			: [];
		if (cmd === 'M') {
			if (poly.length) polygons.push(poly);
			poly = [[(x = n[0]), (y = n[1])]];
		} else if (cmd === 'L') {
			poly.push([(x = n[0]), (y = n[1])]);
		} else if (cmd === 'Q') {
			const [x0, y0] = [x, y];
			for (let t = 1 / 8; t <= 1.0001; t += 1 / 8) {
				const s = 1 - t;
				poly.push([
					s * s * x0 + 2 * s * t * n[0] + t * t * n[2],
					s * s * y0 + 2 * s * t * n[1] + t * t * n[3]
				]);
			}
			[x, y] = [n[2], n[3]];
		} else if (poly.length) {
			polygons.push(poly);
			poly = [];
		}
	}
	if (poly.length) polygons.push(poly);
	return polygons;
}

const B_POLYGONS = toPolygons(B_PATH);

/** Even-odd fill test, so the counters of the B stay open. */
function inPolygons(x, y, polygons) {
	let inside = false;
	for (const poly of polygons) {
		for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
			const [xi, yi] = poly[i];
			const [xj, yj] = poly[j];
			if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
		}
	}
	return inside;
}

// The W: a polyline stroked 4 units wide with round joins and caps.
const WAVE = [
	[33, 22],
	[38, 42],
	[43, 30],
	[48, 42],
	[53, 22],
	[56, 32]
];
const WAVE_HALF_WIDTH = 2;

function nearPolyline(x, y, points, r) {
	for (let i = 1; i < points.length; i++) {
		const [ax, ay] = points[i - 1];
		const [bx, by] = points[i];
		const t = Math.max(
			0,
			Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2))
		);
		if ((x - ax - t * (bx - ax)) ** 2 + (y - ay - t * (by - ay)) ** 2 <= r * r) return true;
	}
	return false;
}

/** Colour of the mark at (u, v) in its own 0..1 box, or null to show the plum background. */
function glyph(u, v) {
	const x = u * 64;
	const y = v * 64;
	if (nearPolyline(x, y, WAVE, WAVE_HALF_WIDTH)) return CORAL;
	if (x < 30.5 && y > 17.9 && y < 47.1 && inPolygons(x, y, B_POLYGONS)) return WHITE;
	return null;
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
					const colour = glyph((x - g0) / glyphBox, (y - g0) / glyphBox) ?? PLUM;
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
	// "any" icons: rounded tile laid out exactly like favicon.svg.
	['icon-192.png', 192, { glyphBox: 1, bgRadius: 0.22 }],
	['icon-512.png', 512, { glyphBox: 1, bgRadius: 0.22 }],
	// Maskable: full bleed; the mark stays inside the central 80% safe circle
	// (at 0.8 scale the farthest point, a corner of the B, is 0.38 from the centre < 0.40).
	['icon-maskable-512.png', 512, { glyphBox: 0.8, bgRadius: 0 }],
	// iOS shows transparency as black and rounds corners itself, so stay opaque and square.
	['apple-touch-icon.png', 180, { glyphBox: 0.9, bgRadius: 0 }]
];

for (const [name, size, opts] of icons) {
	const png = render(size, opts);
	writeFileSync(new URL(name, outDir), png);
	console.log(`static/icons/${name} ${size}x${size} ${png.length} bytes`);
}
