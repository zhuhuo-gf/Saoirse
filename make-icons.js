'use strict';
// Build all app icons from the source PNG:
//   build/icon.png  (512x512, for Linux/macOS)
//   build/icon.ico  (multi-size, for Windows exe)
//   assets/tray.png (32x32, system tray)
//   assets/icon.png (512x512 copy, bundled for tray/notification at runtime)
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'assets', 'saoirse-mark.svg');
const buildDir = path.join(__dirname, 'build');
const assetsDir = path.join(__dirname, 'assets');
fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(assetsDir, { recursive: true });

const icoSizes = [16, 24, 32, 48, 64, 128, 256];

function toPng(size) {
  return sharp(src)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}

async function main() {
  const meta = await sharp(src).metadata();
  console.log(`源图: ${meta.width}x${meta.height} ${meta.format}`);

  // 512px master PNG
  const png512 = await toPng(512);
  fs.writeFileSync(path.join(buildDir, 'icon.png'), png512);
  fs.copyFileSync(path.join(buildDir, 'icon.png'), path.join(assetsDir, 'icon.png'));
  console.log('生成 build/icon.png + assets/icon.png (512x512)');

  // 32px tray icon
  fs.writeFileSync(path.join(assetsDir, 'tray.png'), await toPng(32));
  console.log('生成 assets/tray.png (32x32)');

  // Multi-size ICO
  const images = [];
  for (const s of icoSizes) images.push(await toPng(s));

  let offset = 6 + 16 * icoSizes.length;
  const entries = icoSizes.map((s, i) => {
    const b = Buffer.alloc(16);
    b.writeUInt8(s === 256 ? 0 : s, 0); // width (0 == 256)
    b.writeUInt8(s === 256 ? 0 : s, 1); // height
    b.writeUInt8(0, 2); // palette
    b.writeUInt8(0, 3); // reserved
    b.writeUInt16LE(1, 4); // planes
    b.writeUInt16LE(32, 6); // bits per pixel
    b.writeUInt32LE(images[i].length, 8); // bytes in resource
    b.writeUInt32LE(offset, 12); // offset
    offset += images[i].length;
    return b;
  });

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(icoSizes.length, 4);

  fs.writeFileSync(path.join(buildDir, 'icon.ico'), Buffer.concat([header, ...entries, ...images]));
  console.log(`生成 build/icon.ico (${icoSizes.join(', ')} 像素)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
