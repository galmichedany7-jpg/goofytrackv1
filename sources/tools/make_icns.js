// Makes the macOS icon (images/goofytrack_icon.icns, given to GoofyTrack.app by setup.js) from the PNG images of
// the Windows one (images/goofytrack_icon.ico): an .icns is a list of PNGs, each tagged with its size. Run it
// again after changing the .ico; the .icns is committed.
//
//   node sources/tools/make_icns.js
const fs = require('fs');
const path = require('path');

const IMAGES = path.join(__dirname, '..', 'images');
const ico = fs.readFileSync(path.join(IMAGES, 'goofytrack_icon.ico'));
const pngs = {};
for (let i = 0, n = ico.readUInt16LE(4); i < n; i++) {
  const entry = 6 + 16 * i, size = ico[entry] || 256;
  const data = ico.subarray(ico.readUInt32LE(entry + 12), ico.readUInt32LE(entry + 12) + ico.readUInt32LE(entry + 8));
  if (data.subarray(0, 4).toString('hex') === '89504e47') pngs[size] = data;   // PNG entries only
}
// icns types: size in pixels (the @2x types reuse the image twice as large)
const TYPES = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic11', 32], ['ic12', 64], ['ic13', 256]];
const chunks = [];
for (const [type, size] of TYPES) {
  if (!pngs[size]) continue;
  const head = Buffer.alloc(8);
  head.write(type, 0, 'ascii');
  head.writeUInt32BE(8 + pngs[size].length, 4);
  chunks.push(head, pngs[size]);
}
if (!chunks.length) throw new Error('goofytrack_icon.ico has no PNG image');
const body = Buffer.concat(chunks), head = Buffer.alloc(8);
head.write('icns', 0, 'ascii');
head.writeUInt32BE(8 + body.length, 4);
fs.writeFileSync(path.join(IMAGES, 'goofytrack_icon.icns'), Buffer.concat([head, body]));
console.log(`Wrote images/goofytrack_icon.icns (${chunks.length / 2} images)`);
