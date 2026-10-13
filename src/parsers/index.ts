import type { DocumentParser } from '../core/draft.js';
import { genericParser } from './generic.js';
import { tuiCruisesParser } from './tui-cruises.js';
import { tuiDeutschlandParser } from './tui-deutschland.js';

/**
 * Alle Parser dieses Repositorys. Der Build macht aus jedem Eintrag ein
 * eigenes Modul. Ein neuer Parser wird hier eingetragen, sonst wird er nicht
 * gebaut — `npm run neu` erledigt das, siehe docs/neuer-parser.md. Der Build liest scripts/entries.mjs;
 * ein Test prüft, dass beide Listen übereinstimmen.
 */
export const parsers: readonly DocumentParser[] = [tuiCruisesParser, tuiDeutschlandParser, genericParser];
