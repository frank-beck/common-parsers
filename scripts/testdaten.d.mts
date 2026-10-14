export declare const POOL: {
  vornamen: string[];
  nachnamen: string[];
  strasse: string;
  ort: string;
  orte: string[];
  telefon: string;
  email: string;
  iban: string;
  geburtsdatum: string;
  reisebuero: string;
  nummer: string;
};
export declare const ERLAUBTE_ORTE: string[];
export declare const ERLAUBTE_TELEFONE: string[];
export declare const NUR_GEGENBEISPIELE: Set<string>;
export declare function pruefeTestdaten(text: string): { index: number; problem: string }[];
