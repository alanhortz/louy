/**
 * Quadtree de tuiles et selection du niveau de detail.
 *
 * A chaque image on descend l'arbre depuis la racine (262 km de cote) jusqu'a
 * ce que le pas d'echantillonnage projete a l'ecran passe sous le seuil demande.
 * Une branche n'est exploree que si sa boite englobante intersecte le cone de
 * vue, ce qui evite de solliciter le reseau pour ce qui est hors champ.
 *
 * Le raffinement est progressif : une tuile grossiere reste affichee tant que
 * ses quatre filles ne sont pas toutes arrivees, de sorte que la vue n'est
 * jamais vide pendant la navigation.
 */

import {
  Box3, BufferAttribute, BufferGeometry, Frustum, Matrix4, Points, Vector3,
} from 'three';
import * as C from '../../domain/tiling.ts';

const KEY = (l, i, j) => `${l}/${i}/${j}`;

class Tile {
  constructor(level, i, j) {
    this.level = level; this.i = i; this.j = j;
    this.key = KEY(level, i, j);
    this.extent = C.tileExtent(level, i, j);
    this.state = 'idle';           // idle | loading | ready | empty | error
    this.points = null;
    this.count = 0;
    this.minY = 0; this.maxY = 700;
    this.lastUsed = 0;
    this.inScene = false;
  }
}

export class TileTree {
  constructor({ scene, materials, loader }) {
    this.scene = scene;
    this.materials = materials;
    this.loader = loader;
    this.tiles = new Map();
    this.frame = 0;
    this.generation = 0;

    this._box = new Box3();
    this._frustum = new Frustum();
    this._m = new Matrix4();
    this._v = new Vector3();

    this.stats = { visible: 0, points: 0, requested: 0, cached: 0 };

    loader.onTile = (key, payload, desc) => this.#onLoaded(key, payload, desc);
    loader.onEmpty = (key) => { const t = this.tiles.get(key); if (t) t.state = 'empty'; };
    loader.onError = (key, msg) => {
      const t = this.tiles.get(key);
      if (!t) return;
      // une tuile affichee dont seul le rhabillage echoue ou est annule reste affichee, a rhabiller plus tard
      if (t.state === 'ready') { this.#unrefreshed(t); return; }
      if (msg) { t.state = 'error'; t.errorAt = this.frame; }
      else t.state = 'idle';                      // annulation : rechargeable
    };
    loader.onDropped = (key) => {
      const t = this.tiles.get(key);
      if (!t) return;
      if (t.state === 'loading') t.state = 'idle';
      else if (t.state === 'ready') this.#unrefreshed(t);
    };
  }

  /** Le rhabillage demande n'a pas abouti : la tuile le redemandera. */
  #unrefreshed(tile) {
    if (!tile.refreshing) return;
    tile.refreshing = false;
    tile.stale = true;
  }

  #get(level, i, j) {
    const key = KEY(level, i, j);
    let t = this.tiles.get(key);
    if (!t) { t = new Tile(level, i, j); this.tiles.set(key, t); }
    return t;
  }

  /** Boite englobante monde d'une tuile, exageration verticale comprise. */
  #worldBox(tile, exaggeration, out) {
    const e = tile.extent;
    out.min.set(e.xmin - C.ORIGIN.x, tile.minY * exaggeration, -(e.ymax - C.ORIGIN.y));
    out.max.set(e.xmax - C.ORIGIN.x, tile.maxY * exaggeration, -(e.ymin - C.ORIGIN.y));
    return out;
  }

  /**
   * Selection recursive. Renvoie true si la branche est entierement couverte
   * par des tuiles affichables (donc si le parent peut s'effacer).
   */
  #visit(tile, ctx) {
    const box = this.#worldBox(tile, ctx.exaggeration, this._box);
    if (!this._frustum.intersectsBox(box)) return true;   // hors champ : rien a couvrir

    tile.lastUsed = this.frame;
    if (tile.state === 'empty') return true;

    // pas d'echantillonnage projete, en pixels
    const dist = Math.max(1, box.distanceToPoint(ctx.camPos));
    const projected = C.tileSpacing(tile.level) * ctx.pixelsPerMeter / dist;

    // Plafond de parcours : la selection ne doit jamais pouvoir couter une
    // image, meme si la camera s'incline vers un horizon lointain.
    ctx.visited++;
    const subdivide = tile.level < ctx.maxLevel
      && projected > ctx.sse
      && ctx.points < ctx.maxPoints
      && ctx.visited < ctx.maxNodes;

    if (subdivide) {
      let covered = true;
      const l = tile.level + 1, bi = tile.i * 2, bj = tile.j * 2;
      for (let dj = 0; dj < 2; dj++) {
        for (let di = 0; di < 2; di++) {
          const ext = C.tileExtent(l, bi + di, bj + dj);
          if (!C.intersectsCoverage(ext)) continue;   // borne à la région active
          covered = this.#visit(this.#get(l, bi + di, bj + dj), ctx) && covered;
        }
      }
      if (covered) return true;
      // filles incompletes : on maintient ce niveau a l'affichage
    }

    this.#want(tile, dist, ctx);
    if (tile.state === 'ready') {
      this.#show(tile, ctx);
      return true;
    }
    return false;
  }

  #want(tile, dist, ctx) {
    // Toute tuile encore utile doit figurer dans `wanted`, y compris celles
    // deja en cours : sinon `retain()` les annulerait a l'image suivante, et le
    // chargement repartirait de zero en boucle.
    ctx.wanted.add(tile.key);

    if (tile.state === 'ready' && tile.stale) {
      // meme relief, autre habillage : la tuile reste a l'ecran pendant que sa remplacante se prepare.
      // Tant qu'une demande abandonnee de cette tuile n'a pas rendu sa reponse, on attend l'image suivante.
      if (this.loader.inflight.has(tile.key)) return;
      tile.stale = false;
      tile.refreshing = true;
      this.loader.enqueue(tile.key, ctx.describe(tile), dist);
      this.stats.requested++;
      return;
    }
    if (tile.state === 'loading' || tile.state === 'ready') {
      // reevalue la priorite : ce que la camera approche doit passer devant
      this.loader.enqueue(tile.key, null, dist);
      return;
    }
    if (tile.state === 'error' && this.frame - (tile.errorAt || 0) < 600) return;

    tile.state = 'loading';
    this.loader.enqueue(tile.key, ctx.describe(tile), dist);
    this.stats.requested++;
  }

  #show(tile, ctx) {
    if (!tile.inScene) { this.scene.add(tile.points); tile.inScene = true; }
    ctx.visible++;
    ctx.points += tile.count;
    ctx.keep.add(tile.key);
  }

  #onLoaded(key, payload, desc) {
    const tile = this.tiles.get(key);
    if (!tile) return;
    // une tuile arrivee apres un changement de modele ou de couleur est perimee
    if (desc && desc.generation !== this.generation) { this.#unrefreshed(tile); return; }

    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(payload.positions, 3));
    g.setAttribute('color', new BufferAttribute(payload.colors, 3, true));
    g.boundingSphere = null;

    const e = tile.extent;
    const spacing = payload.outSpacing || C.tileSpacing(tile.level);
    const pts = new Points(g, this.materials.get(spacing));
    pts.position.set(e.xmin - C.ORIGIN.x, 0, -(e.ymax - C.ORIGIN.y));
    pts.frustumCulled = false;      // le quadtree fait deja le culling
    pts.matrixAutoUpdate = false;
    pts.updateMatrix();

    // une tuile rhabillee remplace l'ancienne sans laisser de trou a l'ecran
    if (tile.points) {
      if (tile.inScene) { this.scene.remove(tile.points); this.scene.add(pts); }
      tile.points.geometry.dispose();
    }
    tile.refreshing = false;
    tile.points = pts;
    tile.count = payload.count;
    tile.minY = payload.minY;
    tile.maxY = payload.maxY;
    tile.state = 'ready';
  }

  /** Selection complete pour une image. */
  update(camera, opts) {
    this.frame++;
    this._m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._m);

    const ctx = {
      camPos: camera.getWorldPosition(this._v),
      // hauteur du canvas / (2 tan(fov/2)) : facteur metre -> pixel a 1 m
      pixelsPerMeter: opts.viewportHeight * 0.5
        / Math.tan((camera.fov * Math.PI / 180) / 2),
      sse: opts.sse,
      exaggeration: opts.exaggeration,
      maxPoints: opts.maxPoints,
      maxLevel: Math.min(C.MAX_LEVEL, opts.maxLevel ?? C.MAX_LEVEL),
      points: 0,
      visible: 0,
      visited: 0,
      maxNodes: 8000,
      frame: this.frame,
      wanted: new Set(),
      keep: new Set(),
      describe: opts.describe,
    };

    this.#visit(this.#get(0, 0, 0), ctx);

    // retire de la scene ce qui n'a pas ete selectionne cette image
    for (const tile of this.tiles.values()) {
      if (tile.inScene && !ctx.keep.has(tile.key)) {
        this.scene.remove(tile.points);
        tile.inScene = false;
      }
    }

    this.loader.retain(ctx.wanted);
    this.loader.flush();

    this.stats.visible = ctx.visible;
    this.stats.points = ctx.points;
    this.stats.cached = this.tiles.size;
    this.#evict(opts.cacheSize, opts.cachePoints ?? Infinity);
    return this.stats;
  }

  /**
   * Purge LRU. Deux niveaux : on libere d'abord la memoire graphique des tuiles
   * chargees mais hors champ, puis on elague les entrees devenues inutiles pour
   * que l'index ne croisse pas indefiniment au fil d'une longue session.
   */
  #evict(limit, pointLimit) {
    const ready = [];
    let cachedPoints = 0;
    for (const t of this.tiles.values()) {
      if (t.state === 'ready' && !t.inScene) { ready.push(t); cachedPoints += t.count; }
    }

    // Deux plafonds : le nombre de tuiles, et surtout le nombre de points. Une
    // tuile suréchantillonnée pese quatre fois plus qu'une autre, compter les
    // tuiles seules laisserait la memoire graphique deriver.
    if (ready.length > limit || cachedPoints > pointLimit) {
      ready.sort((a, b) => a.lastUsed - b.lastUsed);
      let k = 0;
      while (k < ready.length && (ready.length - k > limit || cachedPoints > pointLimit)) {
        const t = ready[k++];
        cachedPoints -= t.count;
        t.points.geometry.dispose();
        t.points = null;
        t.state = 'idle';
        t.count = 0;
      }
    }

    // Les tuiles « vides » sont conservees : elles memorisent une absence de
    // donnee (hors Wallonie) et evitent de reinterroger le serveur pour rien.
    if (this.tiles.size > limit * 4) {
      const stale = [];
      for (const t of this.tiles.values()) {
        if (t.state === 'idle' && !t.inScene) stale.push(t);
      }
      stale.sort((a, b) => a.lastUsed - b.lastUsed);
      for (let k = 0; k < stale.length >> 1; k++) this.tiles.delete(stale[k].key);
    }
  }

  /**
   * Meme relief, autre habillage (un autre millesime de photo aerienne) : rien
   * n'est vide. Chaque tuile deja la reste affichee et sera redemandee quand la
   * selection la voudra ; ce qui etait en chemin est abandonne.
   */
  retint() {
    this.generation++;
    this.loader.cancelAll();
    for (const t of this.tiles.values()) {
      if (t.state === 'ready') { t.stale = true; t.refreshing = false; }
      // la file vient d'etre videe : ce qui attendait d'etre charge sera redemande
      else if (t.state === 'loading') t.state = 'idle';
    }
  }

  /** Vide tout : changement de modele, de source de couleur ou de densite. */
  reset() {
    this.generation++;
    this.loader.cancelAll();
    for (const t of this.tiles.values()) {
      if (t.inScene) { this.scene.remove(t.points); t.inScene = false; }
      if (t.points) { t.points.geometry.dispose(); t.points = null; }
    }
    this.tiles.clear();
  }
}
