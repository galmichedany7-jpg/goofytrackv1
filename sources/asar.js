// Minimal reader for Electron .asar archives (no dependencies)
const fs = require('fs');
const path = require('path');

function open(file) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(16);
  fs.readSync(fd, head, 0, 16, 0);
  const headerSize = head.readUInt32LE(4), jsonSize = head.readUInt32LE(12);
  const json = Buffer.alloc(jsonSize);
  fs.readSync(fd, json, 0, jsonSize, 16);
  return { fd, header: JSON.parse(json.toString('utf8')), base: 8 + headerSize };
}

function readEntry(archive, entry) {
  const buf = Buffer.alloc(entry.size);
  fs.readSync(archive.fd, buf, 0, entry.size, archive.base + Number(entry.offset));
  return buf;
}

// Read one file, e.g. readFile('app.asar', 'models/car.glb')
function readFile(file, inner) {
  const archive = open(file);
  let node = archive.header;
  for (const part of inner.split('/')) {
    node = node.files && node.files[part];
    if (node == null) { fs.closeSync(archive.fd); throw new Error(`${inner} not found in ${file}`); }
  }
  const buf = readEntry(archive, node);
  fs.closeSync(archive.fd);
  return buf;
}

// Unpack the whole archive into a folder
function extractAll(file, dest) {
  const archive = open(file);
  let count = 0;
  const walk = (node, rel) => {
    for (const [name, entry] of Object.entries(node.files)) {
      const out = path.join(dest, rel, name);
      if (entry.files) { fs.mkdirSync(out, { recursive: true }); walk(entry, path.join(rel, name)); }
      else if (!entry.unpacked && !entry.link) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, readEntry(archive, entry)); count++; }
    }
  };
  fs.mkdirSync(dest, { recursive: true });
  walk(archive.header, '');
  fs.closeSync(archive.fd);
  return count;
}

module.exports = { readFile, extractAll };
