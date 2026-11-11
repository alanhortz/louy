/**
 * Empreinte de provenance — encodage et décodage.
 *
 * Chaque construction porte, dissimulée dans ses fichiers, une empreinte qui
 * dit qui l'a produite, depuis quel commit et quand. Elle permet de prouver
 * l'origine d'une copie du site retrouvée ailleurs. Elle est signée (HMAC) avec
 * un secret qui n'est jamais publié : on peut la lire, pas la contrefaire.
 *
 * Deux porteurs indépendants, pour survivre à la perte de l'un d'eux :
 *  - dans le JavaScript : une table d'entiers 32 bits, réellement utilisée par
 *    le code (elle sert de graine aux identifiants de session) et donc conservée
 *    par le minifieur ;
 *  - dans le HTML : une suite de caractères de largeur nulle, invisible à
 *    l'écran comme à la sélection.
 */

import { createHmac } from 'node:crypto';

export interface Provenance {
  owner: string;
  commit: string;
  /** Date de construction, en heures Unix. */
  builtAt: number;
}

export interface DecodedProvenance extends Provenance {
  /** Signature portée par l'empreinte (hexadécimal). */
  signature: string;
}

/** Premier mot de la table : la constante du hachage de Knuth, banale dans du code. */
export const MAGIC = 0x9e3779b1;

const SIGNATURE_BYTES = 8;
const ZERO = '​'; // espace de largeur nulle
const ONE = '‌';  // antiliant de largeur nulle
const FRAME = '⁠'; // gluon de mots

const serialize = ({ owner, commit, builtAt }: Provenance) => `${owner}|${commit}|${builtAt.toString(36)}`;

export function sign(provenance: Provenance, secret: string): string {
  return createHmac('sha256', secret).update(serialize(provenance)).digest('hex').slice(0, SIGNATURE_BYTES * 2);
}

/** Flux pseudo-aléatoire (xorshift32) qui blanchit l'empreinte : aucun texte lisible dans le bundle. */
function* keystream(): Generator<number, never> {
  let state = MAGIC;
  for (;;) {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    yield state & 0xff;
  }
}

function whiten(bytes: Uint8Array): Uint8Array {
  const stream = keystream();
  return bytes.map((byte) => byte ^ stream.next().value);
}

function toBytes(provenance: Provenance, secret: string): Uint8Array {
  const text = new TextEncoder().encode(serialize(provenance));
  const signature = Buffer.from(sign(provenance, secret), 'hex');
  return whiten(Uint8Array.from([text.length, ...text, ...signature]));
}

function fromBytes(bytes: Uint8Array): DecodedProvenance | null {
  const plain = whiten(bytes);
  const length = plain[0] ?? 0;
  if (length === 0 || plain.length < 1 + length + SIGNATURE_BYTES) return null;
  const [owner, commit, builtAt] = new TextDecoder().decode(plain.subarray(1, 1 + length)).split('|');
  if (!owner || !commit || !builtAt) return null;
  return {
    owner,
    commit,
    builtAt: parseInt(builtAt, 36),
    signature: Buffer.from(plain.subarray(1 + length, 1 + length + SIGNATURE_BYTES)).toString('hex'),
  };
}

/* ----------------------------------------------------- porteur : entiers --- */

export function encodeWords(provenance: Provenance, secret: string): number[] {
  const bytes = toBytes(provenance, secret);
  const padded = new Uint8Array(Math.ceil(bytes.length / 4) * 4);
  padded.set(bytes);
  const view = new DataView(padded.buffer);
  return [MAGIC, ...Array.from({ length: padded.length / 4 }, (_, k) => view.getUint32(k * 4))];
}

/** Retrouve l'empreinte dans un fichier JavaScript, minifié ou non. */
export function decodeWords(source: string): DecodedProvenance | null {
  const literal = '(?:0x[0-9a-f]+|\\d+(?:e\\d+)?)';
  const tables = new RegExp(`\\[\\s*(${literal}(?:\\s*,\\s*${literal})+)\\s*\\]`, 'gi');
  for (const [, body] of source.matchAll(tables)) {
    const words = body!.split(',').map((word) => Number(word.trim()));
    if (words[0] !== MAGIC) continue;
    const bytes = new Uint8Array((words.length - 1) * 4);
    const view = new DataView(bytes.buffer);
    words.slice(1).forEach((word, k) => view.setUint32(k * 4, word));
    const decoded = fromBytes(bytes);
    if (decoded) return decoded;
  }
  return null;
}

/* ------------------------------------------ porteur : caractères invisibles --- */

export function encodeInvisible(provenance: Provenance, secret: string): string {
  const bits = Array.from(toBytes(provenance, secret), (byte) => byte.toString(2).padStart(8, '0')).join('');
  return FRAME + bits.replaceAll('0', ZERO).replaceAll('1', ONE) + FRAME;
}

/** Retrouve l'empreinte dans un texte ou un document HTML. */
export function decodeInvisible(text: string): DecodedProvenance | null {
  const match = new RegExp(`${FRAME}([${ZERO}${ONE}]{16,})${FRAME}`).exec(text);
  if (!match) return null;
  const bits = match[1]!.replaceAll(ZERO, '0').replaceAll(ONE, '1');
  const bytes = Uint8Array.from(bits.match(/.{8}/g) ?? [], (byte) => parseInt(byte, 2));
  return fromBytes(bytes);
}
