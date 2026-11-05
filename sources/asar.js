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

// The paths of the files of the archive ('electron/main.js'…)
function list(file) {
  const archive = open(file);
  fs.closeSync(archive.fd);
  const out = [];
  const walk = (node, rel) => {
    for (const [name, entry] of Object.entries(node.files)) {
      if (entry.files) walk(entry, rel + name + '/');
      else if (!entry.unpacked && !entry.link) out.push(rel + name);
    }
  };
  walk(archive.header, '');
  return out;
}

// Write an archive from a Map of path ('electron/main.js'…) -> Buffer (polytrack.js)
// Layout: a 4-byte size (4), the size of the header pickle; the pickle: its payload size, the JSON's length, the
// JSON padded to 4 bytes; then the files, one after the other (offsets in the header, from there, as strings).
function pack(files, out) {
  const header = { files: {} };
  let offset = 0;
  const bodies = [];
  for (const [file, buf] of files) {
    const parts = file.split('/');
    let node = header;
    for (const dir of parts.slice(0, -1)) node = (node.files[dir] ??= { files: {} });
    node.files[parts[parts.length - 1]] = { size: buf.length, offset: String(offset) };
    offset += buf.length;
    bodies.push(buf);
  }
  const json = Buffer.from(JSON.stringify(header), 'utf8');
  const padded = Math.ceil(json.length / 4) * 4;
  const head = Buffer.alloc(16 + padded);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(8 + padded, 4);
  head.writeUInt32LE(4 + padded, 8);
  head.writeUInt32LE(json.length, 12);
  json.copy(head, 16);
  const fd = fs.openSync(out, 'w');
  try { for (const buf of [head, ...bodies]) fs.writeSync(fd, buf); } finally { fs.closeSync(fd); }
}

module.exports = { readFile, extractAll, list, pack };
