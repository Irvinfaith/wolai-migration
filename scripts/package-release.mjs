import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { zipSync } from 'fflate';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const manifest = JSON.parse(read('manifest.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const versions = JSON.parse(read('versions.json'));
const { values: { tag } } = parseArgs({ options: { tag: { type: 'string' } } });

if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || pkg.version !== manifest.version ||
    lock.version !== manifest.version || versions[manifest.version] !== manifest.minAppVersion) {
  throw new Error('The release version or compatibility mapping does not match.');
}
if (tag !== undefined && tag !== manifest.version) throw new Error('The tag must match manifest.json exactly.');

// Include only deliverables and their documentation. In particular, local exports never enter the bundle.
const entries = ['main.js', 'manifest.json', 'styles.css', 'versions.json', 'README.md', 'CONTRIBUTING.md',
  'CHANGELOG.md', 'SECURITY.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'tools/package_bases.py'];
const files = Object.fromEntries(entries.map((path) => [`${manifest.id}/${path}`, read(path)]));
const output = `release/${manifest.id}-${manifest.version}.zip`;
mkdirSync(new URL('release/', root), { recursive: true });
writeFileSync(new URL(output, root), zipSync(files, { mtime: new Date('2020-01-01T12:00:00Z') }));
console.log(output);
