/**
 * Inspecteur XState → télémétrie.
 *
 * Branché sur l'acteur racine, il voit passer tout ce que le système d'acteurs
 * échange : chaque événement reçu par une machine et chaque changement d'état.
 * C'est ce qui garantit un historique *complet* sans qu'aucune machine n'ait à
 * penser à journaliser quoi que ce soit.
 */

import type { AnyActorRef, InspectionEvent } from 'xstate';
import type { LambertPoint } from '../domain/lambert2008.ts';
import { nearDevice } from '../domain/whereabouts.ts';
import { sanitize, type TelemetryBuffer } from '../services/telemetry.ts';

/** Identifiant donné à l'acteur lors de son invocation. */
const idOf = (actor: InspectionEvent['actorRef'] | undefined): string | undefined =>
  (actor as AnyActorRef | undefined)?.id;

/** La télémétrie ne s'enregistre pas elle-même : chaque écriture en provoquerait une autre. */
const isTelemetry = (actorId: string | undefined) => actorId?.startsWith('telemetry') ?? false;

/** La machine de localisation : rien de ce qu'elle reçoit ou annonce n'est consigné en clair. */
const isLocation = (actorId: string | undefined) => actorId?.startsWith('location') ?? false;

/** Ce qui remplace, dans le journal, une charge utile qui trahirait où se trouve le visiteur. */
const CONCEALED = { masqué: 'position du visiteur' };

const isPoint = (value: unknown): value is LambertPoint =>
  typeof value === 'object' && value !== null
  && Number.isFinite((value as LambertPoint).x) && Number.isFinite((value as LambertPoint).y);

/** Premier point (x, y) trouvé dans une charge utile. */
function findPoint(value: unknown, depth = 0): LambertPoint | null {
  if (isPoint(value)) return value;
  if (typeof value !== 'object' || value === null || depth > 4) return null;
  for (const inner of Object.values(value)) {
    const found = findPoint(inner, depth + 1);
    if (found) return found;
  }
  return null;
}

/** La charge utile porte-t-elle un point proche de l'appareil ? */
function betrays(value: unknown, device: LambertPoint, depth = 0): boolean {
  if (typeof value !== 'object' || value === null || depth > 4) return false;
  if (isPoint(value) && nearDevice(device, value.x, value.y)) return true;
  return Object.values(value).some((inner) => betrays(inner, device, depth + 1));
}

export function createTelemetryInspector(buffer: TelemetryBuffer) {
  /**
   * Position de l'appareil, si le visiteur l'a demandée : gardée en mémoire le temps de
   * la page, pour masquer toute coordonnée qui la trahirait. Elle n'est jamais écrite.
   */
  let device: LambertPoint | null = null;

  /** Dernier état consigné par acteur : un instantané sans transition n'est pas répété. */
  const lastState = new Map<string, string>();

  return (inspection: InspectionEvent): void => {
    const actor = idOf(inspection.actorRef) ?? 'inconnu';
    if (isTelemetry(actor)) return;

    if (inspection.type === '@xstate.event') {
      const source = idOf(inspection.sourceRef);
      if (isTelemetry(source)) return;
      const { type, ...payload } = inspection.event;
      const located = isLocation(actor) || isLocation(source);
      if (located) device = findPoint(payload) ?? device;
      const concealed = located || (device !== null && betrays(payload, device));
      buffer.push({
        k: 'event',
        a: actor,
        f: source,
        n: type,
        d: !Object.keys(payload).length ? undefined : concealed ? CONCEALED : sanitize(payload),
      });
      return;
    }

    if (inspection.type === '@xstate.snapshot' && 'value' in inspection.snapshot) {
      const state = JSON.stringify(inspection.snapshot.value);
      if (lastState.get(actor) === state) return;
      lastState.set(actor, state);
      buffer.push({ k: 'state', a: actor, n: inspection.snapshot.value });
    }
  };
}
