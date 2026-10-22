/// <reference types="vite/client" />

declare module 'hyphen/en-us/index.js' {
  const hyphen: { hyphenateSync(text: string, options?: { hyphenChar?: string; minWordLength?: number; debug?: boolean; exceptions?: string[] }): string };
  export default hyphen;
}
