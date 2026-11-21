import { useSelector } from '@xstate/react';
import { useEffect, useRef } from 'react';
import { tourPhase, tourTime } from '../../machines/tour.machine.ts';
import { useChild } from '../actors.ts';

/**
 * Au cockpit d'un drone, ce que sa caméra a vraiment filmé, en vignette en haut à droite, calée sur l'instant
 * de la visite : le même instant que la caméra de la carte, que la visite joue, soit en pause, ou que le
 * visiteur l'ait avancée ou reculée à la molette. Sans vidéo pour ce vol, rien ne s'affiche.
 */
export function TourFeed() {
  const tour = useChild('tour');
  const phase = useSelector(tour, tourPhase);
  const src = useSelector(tour, (snapshot) => snapshot.context.flight?.video ?? null);
  const t = useSelector(tour, tourTime);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = video.current;
    if (!element || element.readyState < 1) return;
    const last = Math.max(0, (element.duration || Infinity) - 0.08);
    const target = Math.min(t, last);
    if (phase === 'playing' && target < last) {
      // en lecture : la vidéo court d'elle-même, on ne la recale que si elle s'écarte vraiment de la visite
      if (Math.abs(element.currentTime - target) > 0.35) element.currentTime = target;
      if (element.paused && !element.seeking) void element.play().catch(() => {});
    } else {
      // en pause, ou au bout : l'image de l'instant exact, immobile
      if (!element.paused) element.pause();
      if (Math.abs(element.currentTime - target) > 0.05) element.currentTime = target;
    }
  }, [phase, t]);

  if (phase === 'idle' || !src) return null;
  return <video ref={video} className="tour-feed" src={src} muted playsInline preload="auto" aria-label="Ce que la caméra du drone a filmé, à cet instant du vol" />;
}
