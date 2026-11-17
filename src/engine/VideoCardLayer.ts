/**
 * Calque des séquences filmées : chaque séquence se joue sur un écran dressé
 * dans la carte, devant l'endroit exact où se tenait la caméra. Quatre arêtes
 * relient l'écran à ce point — le champ de la caméra, tel qu'il était. Quand la
 * caméra a bougé pendant la prise, l'écran refait son trajet au fil de la lecture.
 *
 * Comme les avions, les écrans ont leur propre scène, rendue après le relief et
 * les lieux reconstruits.
 */

import {
  BufferAttribute, Line, LineDashedMaterial, Points, PointsMaterial,
  BufferGeometry, DoubleSide, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh,
  MeshBasicMaterial, Raycaster, Shape, ShapeGeometry, Scene as ThreeScene, SRGBColorSpace, Vector2, VideoTexture,
  type PerspectiveCamera, type WebGLRenderer,
} from 'three';
import { clipPose, clipScreenDistance, clipScreenSize, type ScanClip } from '../domain/clips.ts';
import * as T from '../domain/tiling.ts';

interface Card {
  clip: ScanClip; video: HTMLVideoElement; texture: VideoTexture; group: Group;
  /** Part écoulée de la piste de progression, sa taille, et la valeur qu'elle montre en ce moment. */
  progress: Mesh; track: { width: number; height: number }; shown: number;
  /** Le chemin de la caméra dans l'espace, quand elle s'est déplacée : parcouru en trait plein, à venir en pointillé. */
  path: { past: Line; future: Line; points: Points } | null;
}

const EDGE_COLOUR = 0x00d4ff;
/** Rayon des coins de l'écran, en part de sa largeur — mesuré sur une image arrondie de référence (11 px pour 468 px de large). */
const CORNER_SHARE = 11 / 468;

/** Contour d'un rectangle aux coins arrondis, en partant du bas à gauche, dans le sens inverse des aiguilles d'une montre. */
function roundedRect(x0: number, y0: number, x1: number, y1: number, radius: number, steps = 8): [number, number][] {
  const r = Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2);
  const points: [number, number][] = [];
  const corners = [[x1 - r, y0 + r, -90], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, 90], [x0 + r, y0 + r, 180]] as const;
  for (const [cx, cy, start] of corners) {
    for (let k = 0; k <= steps; k++) {
      const angle = ((start + (90 * k) / steps) * Math.PI) / 180;
      points.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
    }
  }
  return points;
}

export class VideoCardLayer {
  readonly #renderer: WebGLRenderer;
  readonly #scene = new ThreeScene();
  readonly #cards = new Map<string, Card>();
  readonly #ray = new Raycaster();
  readonly #pointer = new Vector2();
  readonly #trail = new LineBasicMaterial({ color: 0xffd97a, transparent: true, opacity: 0.95, depthTest: false });
  readonly #ahead = new LineDashedMaterial({ color: 0xffd97a, transparent: true, opacity: 0.6, dashSize: 0.6, gapSize: 0.5, depthTest: false });
  readonly #stops = new PointsMaterial({ color: 0xffd97a, size: 6, sizeAttenuation: false, depthTest: false });
  readonly #edges = new LineBasicMaterial({ color: EDGE_COLOUR, transparent: true, opacity: 0.9, depthTest: false });

  constructor(renderer: WebGLRenderer) {
    this.#renderer = renderer;
  }

  /** Une séquence se joue : la carte doit être redessinée à chaque image. */
  get playing(): boolean {
    for (const card of this.#cards.values()) if (!card.video.paused && !card.video.ended) return true;
    return false;
  }

  setClips(clips: readonly ScanClip[]): void {
    const wanted = new Map(clips.map((clip) => [clip.id, clip]));
    for (const [id, card] of this.#cards) {
      if (wanted.has(id)) continue;
      this.#discard(card);
      this.#cards.delete(id);
    }
    for (const clip of clips) if (!this.#cards.has(clip.id)) this.#cards.set(clip.id, this.#build(clip));
  }

  #build(clip: ScanClip): Card {
    const video = document.createElement('video');
    // muette et en ligne : c'est la condition pour qu'un téléphone la joue sans geste du visiteur
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = clip.src;
    void video.play().catch(() => { /* lecture refusée : l'écran garde sa première image */ });

    const texture = new VideoTexture(video);
    texture.colorSpace = SRGBColorSpace;
    const { width, height } = clipScreenSize(clip), distance = clipScreenDistance(clip);
    // la caméra regarde vers −z : l'écran est devant elle, tourné vers elle
    const w = width / 2, h = height / 2;
    // des coins arrondis, comme une image dans une conversation : plus doux à l'œil qu'un rectangle vif
    const radius = width * CORNER_SHARE;
    const outline = roundedRect(-w, -h, w, h, radius);
    const face = new ShapeGeometry(new Shape(outline.map(([x, y]) => new Vector2(x, y))));
    // la forme ne porte pas de coordonnées d'image : chaque sommet prend celles de sa place dans l'écran
    const at = face.getAttribute('position'), uv = face.getAttribute('uv');
    for (let k = 0; k < at.count; k++) uv.setXY(k, (at.getX(k) + w) / width, (at.getY(k) + h) / height);
    const screen = new Mesh(face, new MeshBasicMaterial({ map: texture, side: DoubleSide, depthTest: false, toneMapped: false }));
    screen.position.z = -distance;
    const lines: number[] = [];
    outline.forEach(([x, y], k) => {
      const [nx, ny] = outline[(k + 1) % outline.length]!;
      lines.push(x, y, -distance, nx, ny, -distance);
    });
    // les quatre arêtes du champ rejoignent le milieu de chaque coin arrondi
    const inset = radius * (1 - Math.SQRT1_2);
    for (const [x, y] of [[-w + inset, h - inset], [w - inset, h - inset], [w - inset, -h + inset], [-w + inset, -h + inset]] as const) {
      lines.push(0, 0, 0, x, y, -distance);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(lines, 3));
    const frame = new LineSegments(geometry, this.#edges);
    frame.renderOrder = 1;

    // Progression : une capsule de verre sombre au bas de l'image, et dedans une piste arrondie que l'accent remplit —
    // le dessin des lecteurs de messagerie et de vidéos courtes, aux teintes de L'Oûy.
    const pill = { width: width * 0.86, height: Math.max(height * 0.034, width * 0.05) };
    const track = { width: pill.width - pill.height * 1.1, height: pill.height * 0.3 };
    const baseY = -h + pill.height * 0.5 + width * 0.05;
    const flat = (geometryOf: ShapeGeometry, colour: number, opacity: number, order: number) => {
      const mesh = new Mesh(geometryOf, new MeshBasicMaterial({ color: colour, transparent: true, opacity, depthTest: false, toneMapped: false, side: DoubleSide }));
      mesh.position.set(0, baseY, -distance);
      mesh.renderOrder = order;
      return mesh;
    };
    const capsule = (wide: number, tall: number) =>
      new ShapeGeometry(new Shape(roundedRect(-wide / 2, -tall / 2, wide / 2, tall / 2, tall / 2).map(([x, y]) => new Vector2(x, y))));
    const glass = flat(capsule(pill.width, pill.height), 0x0c0c14, 0.72, 2);
    const rail = flat(capsule(track.width, track.height), 0xffffff, 0.22, 3);
    const progress = flat(capsule(track.height, track.height), EDGE_COLOUR, 1, 4);
    const group = new Group();
    group.add(screen, frame, glass, rail, progress);
    this.#scene.add(group);
    return { clip, video, texture, group, progress, track, shown: -1, path: this.#path(clip) };
  }

  /** Tracé de la caméra : rien si elle n'a pas bougé de plus d'un mètre pendant la séquence. */
  #path(clip: ScanClip): Card['path'] {
    const first = clip.track[0]!;
    if (!clip.track.some((key) => Math.hypot(key.x - first.x, key.y - first.y, key.altitude - first.altitude) > 1)) return null;
    const positions = new Float32Array(clip.track.length * 3);
    clip.track.forEach((key, at) => positions.set([key.x - T.ORIGIN.x, key.altitude, -(key.y - T.ORIGIN.y)], at * 3));
    const geometry = () => new BufferGeometry().setAttribute('position', new BufferAttribute(positions, 3));
    const past = new Line(geometry(), this.#trail);
    const future = new Line(geometry(), this.#ahead);
    future.computeLineDistances();
    // un point à chaque pose connue : on voit où la caméra s'est tenue
    const points = new Points(geometry(), this.#stops);
    for (const part of [past, future, points]) { part.frustumCulled = false; part.renderOrder = 5; this.#scene.add(part); }
    return { past, future, points };
  }

  #discard(card: Card): void {
    for (const part of card.path ? [card.path.past, card.path.future, card.path.points] : []) { this.#scene.remove(part); part.geometry.dispose(); }
    card.video.pause();
    card.video.removeAttribute('src');
    card.video.load();
    card.texture.dispose();
    this.#scene.remove(card.group);
    card.group.traverse((node) => {
      const mesh = node as Mesh;
      mesh.geometry?.dispose();
      if (mesh.material && mesh.material !== this.#edges) (mesh.material as MeshBasicMaterial).dispose();
    });
  }

  /**
   * Séquence dont l'écran est sous un point de l'image (coordonnées de −1 à 1, y vers le haut) ;
   * `null` si le point n'en touche aucun.
   */
  pick(camera: PerspectiveCamera, x: number, y: number): string | null {
    if (this.#cards.size === 0) return null;
    this.#scene.updateMatrixWorld(true);
    this.#ray.setFromCamera(this.#pointer.set(x, y), camera);
    let nearest: { id: string; distance: number } | null = null;
    for (const [id, card] of this.#cards) {
      const hit = this.#ray.intersectObject(card.group.children[0]!, false)[0];
      if (hit && (!nearest || hit.distance < nearest.distance)) nearest = { id, distance: hit.distance };
    }
    return nearest?.id ?? null;
  }

  /** À appeler après les autres passes : dessine par-dessus, sans rien effacer. */
  render(camera: PerspectiveCamera, hidden?: (x: number, y: number, z: number) => boolean): void {
    if (this.#cards.size === 0) return;
    for (const card of this.#cards.values()) {
      const { clip, video, group, progress, track } = card;
      // la part écoulée est une capsule qui s'allonge depuis la gauche ; elle n'est redessinée que lorsqu'elle a visiblement grandi
      const done = video.duration > 0 ? Math.min(1, video.currentTime / video.duration) : 0;
      if (Math.abs(done - card.shown) > 0.004) {
        card.shown = done;
        const length = Math.max(track.height, track.width * done);
        progress.geometry.dispose();
        progress.geometry = new ShapeGeometry(new Shape(
          roundedRect(-track.width / 2, -track.height / 2, -track.width / 2 + length, track.height / 2, track.height / 2).map(([x, y]) => new Vector2(x, y))));
      }
      if (card.path) {
        // parcouru jusqu'à la pose courante, à venir au-delà
        let reached = 0;
        while (reached < clip.track.length - 1 && clip.track[reached + 1]!.t <= video.currentTime) reached++;
        card.path.past.geometry.setDrawRange(0, reached + 1);
        card.path.future.geometry.setDrawRange(reached, clip.track.length - reached);
        for (const part of [card.path.past, card.path.future, card.path.points]) part.visible = group.visible;
      }
      // l'écran est là où était la caméra à l'instant que montre la séquence
      const pose = clipPose(clip.track, video.currentTime);
      group.position.set(pose.x - T.ORIGIN.x, pose.altitude, -(pose.y - T.ORIGIN.y));
      group.quaternion.set(...pose.q);
      // à pied dans un lieu, un écran que le lieu cache ne se voit pas à travers lui
      group.visible = !hidden?.(group.position.x, group.position.y, group.position.z);
    }
    const autoClear = this.#renderer.autoClear;
    this.#renderer.autoClear = false;
    this.#renderer.setRenderTarget(null);
    this.#renderer.render(this.#scene, camera);
    this.#renderer.autoClear = autoClear;
  }

  dispose(): void {
    this.setClips([]);
    this.#edges.dispose();
    for (const material of [this.#trail, this.#ahead, this.#stops]) material.dispose();
  }
}
