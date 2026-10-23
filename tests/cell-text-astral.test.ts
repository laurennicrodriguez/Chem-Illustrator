import { describe, it, expect } from 'vitest';
import { chemPieces } from '../src/sheet/cell-text';

describe('cell text with characters outside the basic plane', () => {
  it('keeps the text whole', () => {
    expect(chemPieces('Run 3 😀').map((p) => p.text).join('')).toBe('Run 3 😀');
    expect(chemPieces('Sample ✔️🧪').map((p) => p.text).join('')).toBe('Sample ✔️🧪');
  });
});
