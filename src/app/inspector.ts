/**
 * Inspecteur XState → télémétrie.
 *
 * Branché sur l'acteur racine, il voit passer tout ce que le système d'acteurs
 * échange : chaque événement reçu par une machine et chaque changement d'état.
 * C'est ce qui garantit un historique *complet* sans qu'aucune machine n'ait à
 * penser à journaliser quoi que ce soit.
 */

import type { AnyActorRef, InspectionEvent } from 'xstate';
import { sanitize, type TelemetryBuffer } from '../services/telemetry.ts';

/** Identifiant donné à l'acteur lors de son invocation. */
const idOf = (actor: InspectionEvent['actorRef'] | undefined): string | undefined =>
  (actor as AnyActorRef | undefined)?.id;

/** La télémétrie ne s'enregistre pas elle-même : chaque écriture en provoquerait une autre. */
const isTelemetry = (actorId: string | undefined) => actorId?.startsWith('telemetry') ?? false;

export function createTelemetryInspector(buffer: TelemetryBuffer) {
  /** Dernier état consigné par acteur : un instantané sans transition n'est pas répété. */
  const lastState = new Map<string, string>();

  return (inspection: InspectionEvent): void => {
    const actor = idOf(inspection.actorRef) ?? 'inconnu';
    if (isTelemetry(actor)) return;

    if (inspection.type === '@xstate.event') {
      const source = idOf(inspection.sourceRef);
      if (isTelemetry(source)) return;
      const { type, ...payload } = inspection.event;
      buffer.push({
        k: 'event',
        a: actor,
        f: source,
        n: type,
        d: Object.keys(payload).length ? sanitize(payload) : undefined,
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
