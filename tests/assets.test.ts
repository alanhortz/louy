import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** L'hébergeur refuse tout fichier publié de plus de 25 Mio : un relevé plus lourd se partage (outils/partager.py). */
const LIMIT = 25 * 1024 * 1024;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    (entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]));
}

describe('fichiers publiés', () => {
  it('aucun ne dépasse la taille que l’hébergeur accepte', () => {
    const heavy = files('public').filter((file) => statSync(file).size > LIMIT);
    expect(heavy).toEqual([]);
  });
});
