export interface Befund { path: string; line: number | null; problem: string }
export declare const ERLAUBTE_DOMAINS: string[];
export declare function alsWort(value: string): RegExp;
export declare function echteAngaben(path?: string): string[];
export declare function pruefe(files: { path: string; content: Buffer }[], echt?: string[]): Befund[];
