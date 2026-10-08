// Development helper: serves the installed (modded) game folder over http so it can be tested in a browser.
//
//   node serve.js ["C:\path\to\PolyTrack"] [port]
const http = require('http');
const fs = require('fs');
const path = require('path');

if (process.argv[2]) process.env.POLYTRACK_DIR = process.argv[2];
const { APP } = require('./config');
const PORT = Number(process.argv[3]) || 8765;

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.track': 'text/plain',
};

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(APP, url === '/' ? 'index.html' : url);
  if (!file.startsWith(APP)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`Serving ${APP} on http://localhost:${PORT}`));
