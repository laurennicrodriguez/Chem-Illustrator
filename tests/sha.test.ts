import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { sha } from '../src/sha';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('sha', () => {
  for (const [name, node] of [['SHA-1', 'sha1'], ['SHA-256', 'sha256'], ['SHA-384', 'sha384'], ['SHA-512', 'sha512']]) {
    it(`${name} agrees with Node's at every length round the block edges`, () => {
      for (const n of [0, 1, 3, 55, 56, 63, 64, 65, 68, 111, 112, 127, 128, 129, 300]) {
        const data = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff);
        expect(hex(sha(name, data))).toBe(createHash(node).update(data).digest('hex'));
      }
    });
  }
});
