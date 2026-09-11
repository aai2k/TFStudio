/**
 * Pack the .tfs document icon: icons/tfs-file.png -> icons/tfs-file.ico
 *
 *   node tools/gen-file-icon.mjs
 *
 * Run it after redrawing the artwork. electron-builder copies the .ico into the
 * install directory and points the registry's DefaultIcon at it, so this is the
 * icon Explorer draws for every .tfs on the machine.
 *
 * Sizes 48 and below are stored as 32-bit BMP and the larger ones as PNG. An
 * all-PNG .ico is legal from Vista on, but some shell surfaces still read the
 * small sizes through the classic path, and a BMP entry is what they expect.
 * The AND mask every BMP entry carries is left at zero: the 32-bit pixel data
 * has an alpha channel of its own, which is what the shell composites with.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(PROJECT_ROOT, 'icons', 'tfs-file.png');
const TARGET = path.join(PROJECT_ROOT, 'icons', 'tfs-file.ico');

// 20 and 40 are the 125% and 250% steps Windows asks for on a scaled display;
// without them the shell picks a neighbour and rescales it.
const BMP_SIZES = [16, 20, 24, 32, 40, 48];
const PNG_SIZES = [64, 128, 256];

// How opaque the outline below is over the background behind the icon.
const OUTLINE_OPACITY = 0.55;

// Grow a coverage map by one pixel in every direction (a 3x3 maximum).
function dilate(coverage, size) {
    const grown = Buffer.alloc(size * size);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let most = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const ny = y + dy;
                    const nx = x + dx;
                    if (ny < 0 || ny >= size || nx < 0 || nx >= size) continue;
                    const value = coverage[ny * size + nx];
                    if (value > most) most = value;
                }
            }
            grown[y * size + x] = most;
        }
    }
    return grown;
}

// A white hairline following the document's outline, one pixel wide whatever the
// icon size. It is drawn here rather than into the artwork because a stroke
// measured in source pixels shrinks with everything else: 5 px on a 1024 px
// canvas is 0.08 of a pixel at 16, which averages into the edge and vanishes.
// The sheet is close in value to a dark file-manager background, so without an
// outline it has no edge at the sizes a file list uses.
//
// The artwork is composited over a silhouette of itself grown by a pixel, so
// only the ring the artwork does not cover stays white.
function outline(rgba, size) {
    const coverage = Buffer.alloc(size * size);
    for (let i = 0; i < size * size; i++) coverage[i] = rgba[i * 4 + 3];
    const grown = dilate(coverage, size);

    const out = Buffer.from(rgba);
    for (let i = 0; i < size * size; i++) {
        const over = rgba[i * 4 + 3] / 255;
        const under = (grown[i] / 255) * OUTLINE_OPACITY;
        const alpha = over + under * (1 - over);
        if (alpha <= 0) continue;
        for (let channel = 0; channel < 3; channel++) {
            out[i * 4 + channel] =
                Math.round((rgba[i * 4 + channel] * over + 255 * under * (1 - over)) / alpha);
        }
        out[i * 4 + 3] = Math.round(alpha * 255);
    }
    return out;
}

// One icon image as a 32-bit BMP: header, bottom-up BGRA rows, then the AND mask.
function bmpImage(rgba, size) {
    const header = Buffer.alloc(40);
    header.writeUInt32LE(40, 0);                  // biSize
    header.writeInt32LE(size, 4);                 // biWidth
    header.writeInt32LE(size * 2, 8);             // biHeight: colour rows + mask rows
    header.writeUInt16LE(1, 12);                  // biPlanes
    header.writeUInt16LE(32, 14);                 // biBitCount
    header.writeUInt32LE(0, 16);                  // biCompression = BI_RGB
    header.writeUInt32LE(size * size * 4, 20);    // biSizeImage

    const colours = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
        const from = y * size * 4;
        const to = (size - 1 - y) * size * 4;     // BMP rows run bottom to top
        for (let x = 0; x < size; x++) {
            const s = from + x * 4;
            const d = to + x * 4;
            colours[d]     = rgba[s + 2];
            colours[d + 1] = rgba[s + 1];
            colours[d + 2] = rgba[s];
            colours[d + 3] = rgba[s + 3];
        }
    }

    // 1 bit per pixel, each row padded to a 4-byte boundary.
    const mask = Buffer.alloc(Math.ceil(size / 32) * 4 * size);
    return Buffer.concat([header, colours, mask]);
}

// ICONDIR + one ICONDIRENTRY per image, then the images themselves.
function icoFile(images) {
    const directory = Buffer.alloc(6 + 16 * images.length);
    directory.writeUInt16LE(0, 0);                // reserved
    directory.writeUInt16LE(1, 2);                // type: icon
    directory.writeUInt16LE(images.length, 4);

    let offset = directory.length;
    images.forEach(({ size, data }, index) => {
        const at = 6 + index * 16;
        // 256 does not fit in a byte and is written as 0.
        directory.writeUInt8(size === 256 ? 0 : size, at);
        directory.writeUInt8(size === 256 ? 0 : size, at + 1);
        directory.writeUInt8(0, at + 2);          // palette size: none
        directory.writeUInt8(0, at + 3);          // reserved
        directory.writeUInt16LE(1, at + 4);       // planes
        directory.writeUInt16LE(32, at + 6);      // bits per pixel
        directory.writeUInt32LE(data.length, at + 8);
        directory.writeUInt32LE(offset, at + 12);
        offset += data.length;
    });

    return Buffer.concat([directory, ...images.map(image => image.data)]);
}

const source = readFileSync(SOURCE);
const images = [];
for (const size of [...BMP_SIZES, ...PNG_SIZES]) {
    const scaled = await sharp(source)
        .resize(size, size, { kernel: 'lanczos3' })
        .ensureAlpha()
        .raw()
        .toBuffer();
    const rgba = outline(scaled, size);
    const data = BMP_SIZES.includes(size)
        ? bmpImage(rgba, size)
        : await sharp(rgba, { raw: { width: size, height: size, channels: 4 } })
            .png({ compressionLevel: 9 })
            .toBuffer();
    images.push({ size, data });
}

writeFileSync(TARGET, icoFile(images));

const { width, height } = await sharp(source).metadata();
console.log(`gen-file-icon: ${width}x${height} source -> ${images.length} sizes `
    + `(${images.map(i => i.size).join(', ')}), ${readFileSync(TARGET).length} bytes`);
console.log(`gen-file-icon: wrote ${path.relative(PROJECT_ROOT, TARGET)}`);
