/**
 * gen-splash.mjs — render the startup artwork from assets/splash.png.
 *
 * The portable stub shows build/splash.bmp the moment the exe starts, while it
 * unpacks the payload. NSIS BgImage and SetBrandingImage display nothing but an
 * uncompressed 24-bit BMP, so this is what the launch splash has to be.
 *
 * The artwork is authored at high resolution, 3:2, carrying the mark and
 * wordmark, with the strip below them left clear for the loading bar. The
 * version is the one thing on the splash that changes per release, so it is
 * drawn here rather than baked in; its placement is expressed as fractions of
 * the artwork, so the source can be re-exported at any resolution.
 *
 * Run by tools/build-renderer.mjs, so every packaged build regenerates it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const artwork = path.join(root, 'assets', 'splash.png');
const outBmp = path.join(root, 'build', 'splash.bmp');

const ASPECT = 1.5;
const MARGIN = 0.0586;          // inset of the mark on the left, mirrored for the version
const BRAND_ROW = 0.883;        // vertical centre of the mark/wordmark row
const VERSION_SIZE = 0.035;
// Physical pixels. The stub sizes its card to match (CARD_W/ART_H in
// build/portable.nsi), so SetBrandingImage blits this 1:1 and nothing is
// resampled. A DPI-aware manifest keeps it that size on scaled displays.
const BMP_W = 600;

/**
 * Encode raw RGB pixels as an uncompressed 24-bit BMP: a 14-byte file header, a
 * 40-byte BITMAPINFOHEADER, then bottom-up BGR rows padded to a 4-byte boundary.
 */
function encodeBmp24(rgb, width, height) {
  const rowSize = (width * 3 + 3) & ~3;
  const pixelBytes = rowSize * height;
  const fileHeader = Buffer.alloc(14);
  fileHeader.write('BM', 0, 'ascii');
  fileHeader.writeUInt32LE(14 + 40 + pixelBytes, 2);
  fileHeader.writeUInt32LE(14 + 40, 10);

  const dib = Buffer.alloc(40);
  dib.writeUInt32LE(40, 0);
  dib.writeInt32LE(width, 4);
  dib.writeInt32LE(height, 8);       // positive: rows are stored bottom-up
  dib.writeUInt16LE(1, 12);          // colour planes
  dib.writeUInt16LE(24, 14);         // bits per pixel
  dib.writeUInt32LE(pixelBytes, 20);
  dib.writeInt32LE(2835, 24);        // 72 dpi, in pixels per metre
  dib.writeInt32LE(2835, 28);

  const pixels = Buffer.alloc(pixelBytes);
  for (let y = 0; y < height; y++) {
    const src = y * width * 3;
    const dst = (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x++) {
      pixels[dst + x * 3] = rgb[src + x * 3 + 2];      // B
      pixels[dst + x * 3 + 1] = rgb[src + x * 3 + 1];  // G
      pixels[dst + x * 3 + 2] = rgb[src + x * 3];      // R
    }
  }
  return Buffer.concat([fileHeader, dib, pixels]);
}

// Mean luminance of the band the wordmark sits on, so the type stays legible
// whether the artwork is dark or light.
async function bandLuminance(w, h) {
  const top = Math.round(h * 0.82);
  const { data } = await sharp(artwork)
    .extract({ left: 0, top, width: w, height: h - top })
    .removeAlpha()
    .resize(1, 1)          // averaging the strip down to a single pixel
    .raw()
    .toBuffer({ resolveWithObject: true });
  return 0.2126 * data[0] + 0.7152 * data[1] + 0.0722 * data[2];
}

// The version, set on the wordmark's centre line and inset from the right edge
// by the same margin the mark uses on the left.
function versionOverlay(version, w, h, onLight) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <text x="${w - Math.round(w * MARGIN)}" y="${Math.round(h * BRAND_ROW)}"
        text-anchor="end" dominant-baseline="central"
        font-family="Segoe UI, DejaVu Sans, sans-serif" font-size="${Math.round(h * VERSION_SIZE)}"
        fill="${onLight ? '#5d6980' : '#7b879e'}" letter-spacing="0.5">Version ${version}</text>
</svg>`);
}

export async function generateSplash() {
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const { width: w, height: h } = await sharp(artwork).metadata();
  if (Math.abs(w / h - ASPECT) > 0.01) {
    throw new Error(`assets/splash.png is ${w}x${h}; the splash card is 3:2`);
  }

  const onLight = (await bandLuminance(w, h)) > 128;
  // Composite at the artwork's own resolution, then downscale: sharp applies
  // resize before composite within one pipeline, which would reject the
  // full-size overlay.
  const composed = await sharp(artwork)
    .composite([{ input: versionOverlay(version, w, h, onLight), left: 0, top: 0 }])
    .flatten({ background: onLight ? '#efece6' : '#01030e' })
    .png()
    .toBuffer();
  fs.mkdirSync(path.dirname(outBmp), { recursive: true });

  const { data, info } = await sharp(composed)
    .resize({ width: BMP_W })
    .removeAlpha()                        // a BMP at 24 bpp carries no alpha
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error(`expected 3 channels for a 24-bit BMP, got ${info.channels}`);
  fs.writeFileSync(outBmp, encodeBmp24(data, info.width, info.height));

  console.log(`[gen-splash] build/splash.bmp (${info.width}x${info.height})`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) await generateSplash();
