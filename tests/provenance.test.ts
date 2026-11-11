import { describe, expect, it } from 'vitest';
import {
  MAGIC, decodeInvisible, decodeWords, encodeInvisible, encodeWords, sign, type Provenance,
} from '../build/entropy/codec.ts';

const provenance: Provenance = { owner: 'Alan Hortz', commit: 'a1b2c3d4e5', builtAt: 494_000 };
const SECRET = 'clef-de-test';

describe('empreinte de provenance', () => {
  it('survit à la minification de la table d’entiers', () => {
    const words = encodeWords(provenance, SECRET);
    expect(words[0]).toBe(MAGIC);
    const minified = `const a=[1,2,3],b=[${words.join(',')}];export{b as E}`;
    expect(decodeWords(minified)).toEqual({ ...provenance, signature: sign(provenance, SECRET) });
  });

  it('lit aussi une table écrite en hexadécimal', () => {
    const hex = encodeWords(provenance, SECRET).map((word) => `0x${word.toString(16)}`).join(', ');
    expect(decodeWords(`var t = [ ${hex} ];`)?.commit).toBe(provenance.commit);
  });

  it('reste invisible dans le HTML et s’y relit', () => {
    const mark = encodeInvisible(provenance, SECRET);
    expect(mark).toMatch(/^[​‌⁠]+$/);
    const html = `<p>dans votre navigateur${mark}. Activez JavaScript.</p>`;
    expect(decodeInvisible(html)).toEqual({ ...provenance, signature: sign(provenance, SECRET) });
  });

  it('ne laisse aucun texte lisible dans le bundle', () => {
    const bytes = encodeWords(provenance, SECRET).flatMap((word) => [word >>> 24, (word >>> 16) & 255, (word >>> 8) & 255, word & 255]);
    expect(String.fromCharCode(...bytes)).not.toContain('Hortz');
  });

  it('distingue une signature authentique d’une contrefaçon', () => {
    const found = decodeWords(`[${encodeWords(provenance, 'autre-clef').join(',')}]`)!;
    expect(sign(found, SECRET)).not.toBe(found.signature);
    expect(sign(found, 'autre-clef')).toBe(found.signature);
  });

  it('ne trouve rien dans un fichier sans empreinte', () => {
    expect(decodeWords('const a=[1,2,3]')).toBeNull();
    expect(decodeInvisible('<p>rien</p>')).toBeNull();
  });
});
