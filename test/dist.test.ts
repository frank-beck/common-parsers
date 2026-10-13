import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, it } from 'vitest';
import { parsers } from '../src/parsers/index.js';
import { parserEntries } from '../scripts/entries.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

interface Entry { id: string; version: string; file: string; sha256: string; fallback: boolean }
let manifest: { schema: number; runtime: { file: string; sha256: string }; parsers: Entry[] };

/**
 * Prüft, was die App tatsächlich lädt: die gebauten Module, nicht die
 * TypeScript-Quellen. Ein Build, der etwas verliert, fällt hier auf.
 */
describe('Gebaute Module', () => {
  beforeAll(async () => {
    execFileSync(process.execPath, [join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'pipe' });
    manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
  }, 60_000);

  it('baut jeden Parser aus src/parsers/index.ts', () => {
    assert.deepEqual(Object.keys(parserEntries).sort(), parsers.map((parser) => parser.id).sort());
    assert.deepEqual(manifest.parsers.map((entry) => entry.id).sort(), parsers.map((parser) => parser.id).sort());
  });

  it('nennt für jede Datei den richtigen SHA-256', async () => {
    for (const entry of [manifest.runtime, ...manifest.parsers]) {
      const actual = createHash('sha256').update(await readFile(join(dist, entry.file))).digest('hex');
      assert.equal(actual, entry.sha256, entry.file);
    }
  });

  it('hat genau einen Auffangparser', () => {
    assert.deepEqual(manifest.parsers.filter((entry) => entry.fallback).map((entry) => entry.id), ['generic']);
  });

  it('liefert Module, die ohne Node-APIs laden und dasselbe ergeben wie die Quellen', async () => {
    const runtime = await import(pathToFileURL(join(dist, manifest.runtime.file)).href);
    const loaded = await Promise.all(
      manifest.parsers.map(async (entry) => (await import(pathToFileURL(join(dist, entry.file)).href)).default)
    );
    const pages = [{ pageNumber: 1, text: 'TUI Cruises GmbH\nReisebestätigung / Rechnung\nVorgang-Nr.: 1234567/1' }];
    assert.equal(runtime.selectParser(loaded, pages)?.parser.id, 'tui-cruises');
    for (const [index, entry] of manifest.parsers.entries()) {
      const source = parsers.find((parser) => parser.id === entry.id)!;
      assert.equal(loaded[index].version, entry.version);
      assert.deepEqual(loaded[index].parse(pages), source.parse(pages));
    }
    // Kein require, kein process, kein fetch: Parser laufen im Browser und
    // dürfen nichts nachladen oder versenden.
    for (const entry of [manifest.runtime, ...manifest.parsers]) {
      const code = await readFile(join(dist, entry.file), 'utf8');
      assert.doesNotMatch(code, /\b(?:require\(|process\.|fetch\(|XMLHttpRequest|import\(|WebSocket|navigator\.sendBeacon)/, entry.file);
    }
  });
});
