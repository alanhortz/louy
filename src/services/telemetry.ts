/**
 * Télémétrie locale.
 *
 * L'historique complet des événements échangés entre les machines à états
 * depuis le chargement de la page est conservé **dans le navigateur du
 * visiteur, et nulle part ailleurs** : rien n'est transmis. Les événements
 * s'accumulent en mémoire, puis sont écrits par lots compressés (NDJSON gzip)
 * dans IndexedDB ; les lots de plus de trente jours sont purgés.
 */

import { ENTROPY } from 'virtual:entropy';
import { gunzip, gzip } from './compression.ts';
import { STORES, transact } from './database.ts';

export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Une ligne de l'historique. */
export interface TelemetryRecord {
  /** Horodatage, en millisecondes Unix. */
  t: number;
  /** Session de page à laquelle l'événement appartient. */
  s: string;
  /** Nature : événement reçu par un acteur, ou changement d'état d'une machine. */
  k: 'event' | 'state';
  /** Acteur concerné. */
  a: string;
  /** Acteur émetteur (événements seulement). */
  f?: string;
  /** Type de l'événement, ou valeur de l'état. */
  n: unknown;
  /** Charge utile de l'événement, assainie. */
  d?: unknown;
}

interface Batch {
  startedAt: number;
  endedAt: number;
  count: number;
  bytes: Uint8Array<ArrayBuffer>;
}

export interface TelemetrySummary {
  batches: number;
  events: number;
  bytes: number;
  since: number | null;
}

/* ------------------------------------------------------------ session --- */

/** Mélange 32 bits (xorshift-multiply) : diffuse l'aléa dans l'identifiant. */
function mix(seed: number, salt: number): number {
  let h = (seed ^ salt) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Identifiant de session de page : aléatoire, sans rapport avec le visiteur. */
function createSessionId(): string {
  const random = crypto.getRandomValues(new Uint32Array(2));
  const folded = ENTROPY.reduce((acc, word, k) => mix(acc, word + k), random[0]!);
  return (folded.toString(36) + random[1]!.toString(36)).slice(0, 12);
}

export const SESSION_ID = createSessionId();

/* ---------------------------------------------------------- assainir --- */

const MAX_STRING = 240;
const MAX_ITEMS = 12;
const MAX_DEPTH = 4;

/**
 * Rend une charge utile sérialisable et bornée : les nœuds DOM, fonctions et
 * acteurs sont remplacés par une étiquette, les grands tableaux par leur taille.
 */
export function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) return { error: value.name, message: value.message };
  if (typeof Node !== 'undefined' && value instanceof Node) return `<${value.nodeName.toLowerCase()}>`;
  if (depth >= MAX_DEPTH) return '…';
  if (Array.isArray(value)) {
    return value.length > MAX_ITEMS
      ? { items: value.length }
      : value.map((item) => sanitize(item, depth + 1));
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return `[${value.constructor?.name ?? 'object'}]`;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, sanitize(item, depth + 1)] as const)
      .filter(([, item]) => item !== undefined),
  );
}

/* ------------------------------------------------------------ tampon --- */

/** Tampon mémoire des événements pas encore écrits. */
export class TelemetryBuffer {
  #records: TelemetryRecord[] = [];

  push(record: Omit<TelemetryRecord, 't' | 's'>): void {
    this.#records.push({ t: Date.now(), s: SESSION_ID, ...record });
  }

  get size(): number {
    return this.#records.length;
  }

  /** Vide le tampon et rend son contenu. */
  drain(): TelemetryRecord[] {
    const records = this.#records;
    this.#records = [];
    return records;
  }

  /** Remet en tête des événements dont l'écriture a échoué. */
  restore(records: TelemetryRecord[]): void {
    this.#records = [...records, ...this.#records];
  }
}

/* ----------------------------------------------------------- stockage --- */

/** Compresse un lot d'événements et l'écrit dans IndexedDB. */
export async function persist(records: readonly TelemetryRecord[]): Promise<void> {
  if (records.length === 0) return;
  const ndjson = `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
  const batch: Batch = {
    startedAt: records[0]!.t,
    endedAt: records.at(-1)!.t,
    count: records.length,
    bytes: (await gzip(ndjson)) as Uint8Array<ArrayBuffer>,
  };
  await transact(STORES.telemetry, 'readwrite', (store) => store.add(batch));
}

/** Supprime les lots sortis de la fenêtre glissante de trente jours. */
export async function prune(now = Date.now()): Promise<void> {
  const expired = IDBKeyRange.upperBound(now - RETENTION_MS);
  const keys = await transact(STORES.telemetry, 'readonly', (store) => store.index('endedAt').getAllKeys(expired));
  if (keys.length === 0) return;
  await transact(STORES.telemetry, 'readwrite', (store) => {
    let last!: IDBRequest<undefined>;
    for (const key of keys) last = store.delete(key);
    return last;
  });
}

const readBatches = () =>
  transact<Batch[]>(STORES.telemetry, 'readonly', (store) => store.getAll());

export async function summarize(): Promise<TelemetrySummary> {
  const batches = await readBatches();
  return {
    batches: batches.length,
    events: batches.reduce((sum, batch) => sum + batch.count, 0),
    bytes: batches.reduce((sum, batch) => sum + batch.bytes.byteLength, 0),
    since: batches.length ? Math.min(...batches.map((batch) => batch.startedAt)) : null,
  };
}

/**
 * Exporte tout l'historique en un seul fichier `.ndjson.gz` : des membres gzip
 * concaténés forment un flux gzip valide, aucun recompactage n'est nécessaire.
 */
export async function exportArchive(): Promise<Blob> {
  const batches = await readBatches();
  return new Blob(batches.map((batch) => batch.bytes), { type: 'application/gzip' });
}

/** Relit l'historique décompressé (diagnostic, tests). */
export async function readAll(): Promise<TelemetryRecord[]> {
  const batches = await readBatches();
  const texts = await Promise.all(batches.map((batch) => gunzip(batch.bytes)));
  return texts.flatMap((text) => text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as TelemetryRecord));
}

export const clear = (): Promise<undefined> =>
  transact(STORES.telemetry, 'readwrite', (store) => store.clear());
