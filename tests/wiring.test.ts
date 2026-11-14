import { describe, expect, it } from 'vitest';
import { appMachine } from '../src/machines/app.machine.ts';

/**
 * Ce que les machines filles annoncent n'a d'effet que si la machine applicative
 * l'écoute. Un branchement oublié ne casse ni les types ni les essais d'une
 * machine prise seule : la fonction disparaît simplement de l'écran. Cette liste
 * est le filet — chaque annonce qui doit produire un effet y figure.
 */
const ANNOUNCEMENTS = [
  // vue et scène
  'viewer.viewSettled', 'viewer.activityChanged', 'viewer.overlayPicked', 'viewer.poseCaptured', 'viewer.followEnded', 'viewer.captured',
  // calques
  'places.changed',
  'cameras.changed', 'cameras.selectionChanged', 'cameras.flyRequested',
  'sites.chosen',
  // avions en direct
  'aircraft.changed', 'aircraft.selectionChanged', 'aircraft.followChanged', 'aircraft.flyRequested',
  // imagerie aérienne et objets scannés
  'layers.listed', 'layers.changed', 'layers.selectionChanged', 'layers.keptChanged', 'layers.expandRequested', 'layers.activated',
  'object.left',
  // film du temps
  'films.markersChanged', 'films.playRequested',
  'timeline.vintageRequested', 'timeline.captureRequested', 'timeline.restoreRequested',
];

describe('branchements de la machine applicative', () => {
  const running = appMachine.config.states!.running as { on: Record<string, unknown> };

  it.each(ANNOUNCEMENTS)('écoute « %s »', (type) => {
    expect(running.on[type], `aucun branchement pour ${type}`).toBeDefined();
  });
});
