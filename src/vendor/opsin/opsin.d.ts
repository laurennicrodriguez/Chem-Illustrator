// Types for opsin.js, OPSIN compiled to JavaScript by opsin-js/ (see opsin-js/README.md).
// Generated code: rebuild it with Maven rather than editing it.

/** Takes the unpacked contents of public/opsin/opsin-data.dat. Returns "" or what went wrong. */
export function load(data: Int8Array): string;
/** Reads one chemical name; returns JSON: {"ok":true,"smiles":...,"warnings":[...]} or {"ok":false,"message":...}. */
export function parse(name: string): string;
export function main(args?: string[]): void;
