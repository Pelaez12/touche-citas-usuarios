import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../public/', import.meta.url);
const assets = {};
const types = {
  html: 'text/html; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  woff2: 'font/woff2',
  txt: 'text/plain; charset=utf-8',
  webmanifest: 'application/manifest+json; charset=utf-8'
};

async function walk(prefix = '') {
  for (const item of await readdir(new URL(prefix, root), { withFileTypes: true })) {
    const path = prefix + item.name;
    if (item.isDirectory()) {
      await walk(path + '/');
    } else {
      const ext = path.split('.').at(-1);
      const type = types[ext];
      if (!type) throw Error('Tipo de archivo público no permitido: ' + path);
      const raw = await readFile(new URL(path, root));
      const etag = '"' + createHash('sha256').update(raw).digest('hex').slice(0, 16) + '"';
      assets['/' + path] = { type, etag, data: raw.toString('base64') };
    }
  }
}

await walk();
await writeFile(
  new URL('../worker/assets.generated.mjs', import.meta.url),
  '// Generated from public/ only.\nexport default ' + JSON.stringify(assets) + ';\n'
);
console.log(JSON.stringify({ publicAssets: Object.keys(assets).length }));
