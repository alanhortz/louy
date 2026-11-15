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
  BufferGeometry, DoubleSide, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh,
  MeshBasicMaterial, PlaneGeometry, Scene as ThreeScene, SRGBColorSpace, VideoTexture,
  type PerspectiveCamera, type WebGLRenderer,
} from 'three';
import { CLIP_SCREEN_WIDTH, clipPose, clipScreenDistance, type ScanClip } from '../domain/clips.ts';
import * as T from '../domain/tiling.ts';

interface Card { clip: ScanClip; video: HTMLVideoElement; texture: VideoTexture; group: Group }

const EDGE_COLOUR = 0x00d4ff;

export class VideoCardLayer {
  readonly #renderer: WebGLRenderer;
  readonly #scene = new ThreeScene();
  readonly #cards = new Map<string, Card>();
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
    const width = CLIP_SCREEN_WIDTH, height = width / clip.aspect, distance = clipScreenDistance(clip);
    // la caméra regarde vers −z : l'écran est devant elle, tourné vers elle
    const screen = new Mesh(
      new PlaneGeometry(width, height),
      new MeshBasicMaterial({ map: texture, side: DoubleSide, depthTest: false, toneMapped: false }),
    );
    screen.position.z = -distance;
    const w = width / 2, h = height / 2;
    const corners = [[-w, h], [w, h], [w, -h], [-w, -h]] as const;
    const lines: number[] = [];
    corners.forEach(([x, y], at) => {
      const [nx, ny] = corners[(at + 1) % 4]!;
      // le cadre de l'écran, puis l'arête qui le relie à la caméra
      lines.push(x, y, -distance, nx, ny, -distance, 0, 0, 0, x, y, -distance);
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(lines, 3));
    const frame = new LineSegments(geometry, this.#edges);
    frame.renderOrder = 1;
    const group = new Group();
    group.add(screen, frame);
    this.#scene.add(group);
    return { clip, video, texture, group };
  }

  #discard(card: Card): void {
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

  /** À appeler après les autres passes : dessine par-dessus, sans rien effacer. */
  render(camera: PerspectiveCamera): void {
    if (this.#cards.size === 0) return;
    for (const { clip, video, group } of this.#cards.values()) {
      // l'écran est là où était la caméra à l'instant que montre la séquence
      const pose = clipPose(clip.track, video.currentTime);
      group.position.set(pose.x - T.ORIGIN.x, pose.altitude, -(pose.y - T.ORIGIN.y));
      group.quaternion.set(...pose.q);
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
  }
}
