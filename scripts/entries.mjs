// Welche Parser gebaut werden. Schlüssel = Parser-id, Wert = Quelldatei#Exportname.
// Ein neuer Parser wird hier und in src/parsers/index.ts eingetragen.
export const parserEntries = {
  'tui-cruises': 'src/parsers/tui-cruises.ts#tuiCruisesParser',
  'tui-deutschland': 'src/parsers/tui-deutschland.ts#tuiDeutschlandParser',
  'dertour-angebot': 'src/parsers/dertour-angebot.ts#dertourAngebotParser',
  generic: 'src/parsers/generic.ts#genericParser'
};
