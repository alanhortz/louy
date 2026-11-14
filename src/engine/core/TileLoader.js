/**
 * Ordonnanceur de chargement des tuiles.
 *
 * Le facteur limitant mesure sur les services du SPW est la latence par requete
 * (~300 ms), pas le volume : le debit utile plafonne autour de 4 a 10 req/s.
 * L'ordonnanceur en tire trois consequences :
 *   - file de priorite reevaluee a chaque image, pour toujours servir d'abord
 *     ce que la camera regarde ;
 *   - annulation immediate de ce qui n'est plus visible, y compris en vol ;
 *   - plafond de requetes simultanees, au-dela duquel le serveur ralentit.
 */

export class TileLoader {
  constructor({ luts, workerCount, maxConcurrent }) {
    this.maxConcurrent = maxConcurrent;
    this.queue = new Map();      // key -> { desc, priority }
    this.inflight = new Map();   // key -> worker
    this.onTile = () => {};
    this.onEmpty = () => {};
    this.onError = () => {};
    this.onDropped = () => {};
    this.stats = { loaded: 0, failed: 0 };

    const n = Math.max(1, workerCount);
    this.workers = [];
    this.ready = Promise.all(Array.from({ length: n }, () => this.#spawn(luts)));
  }

  #spawn(luts) {
    const w = new Worker(new URL('./tile.worker.js', import.meta.url),
      { type: 'module' });
    w.pending = 0;
    this.workers.push(w);

    return new Promise((resolve) => {
      w.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === 'ready') { resolve(); return; }

        w.pending--;
        const entry = this.inflight.get(m.id);
        this.inflight.delete(m.id);

        if (m.type === 'done') {
          this.stats.loaded++;
          this.onTile(m.id, m, entry?.desc);
        } else if (m.type === 'empty') {
          this.onEmpty(m.id);
        } else if (m.type === 'error') {
          if (!m.aborted) { this.stats.failed++; this.onError(m.id, m.message); }
          else this.onError(m.id, null);
        }
        this.#pump();
      };
      w.postMessage({ type: 'init', luts });
    });
  }

  /**
   * Remplace les tables couleur→altitude de tous les workers (changement de
   * région). Le worker fusionne par clé de modèle ('mnt'/'mns'), donc les LUT
   * de la nouvelle région écrasent les précédentes. À faire AVANT tree.reset().
   */
  setLuts(luts) {
    for (const w of this.workers) w.postMessage({ type: 'init', luts });
  }

  /**
   * Inscrit une tuile dans la file, ou reordonne celle qui s'y trouve deja.
   * `desc` null signifie « mise a jour de priorite seulement ».
   */
  enqueue(key, desc, priority) {
    if (this.inflight.has(key)) return;
    const cur = this.queue.get(key);
    if (cur) { cur.priority = priority; return; }
    if (!desc) return;
    this.queue.set(key, { desc, priority });
  }

  /** Retire une tuile de la file, et annule son chargement s'il a commence. */
  cancel(key) {
    this.queue.delete(key);
    const entry = this.inflight.get(key);
    if (entry) entry.worker.postMessage({ type: 'abort', id: key });
  }

  /** Annule tout (changement de modele, de couleur ou de densite). */
  cancelAll() {
    this.queue.clear();
    for (const [key, entry] of this.inflight) {
      entry.worker.postMessage({ type: 'abort', id: key });
    }
  }

  /**
   * Ne conserve que les tuiles encore demandees par le selecteur. Les tuiles
   * abandonnees sont signalees pour redevenir rechargeables si la camera
   * revient dessus.
   */
  retain(wantedKeys) {
    for (const key of [...this.queue.keys()]) {
      if (!wantedKeys.has(key)) { this.queue.delete(key); this.onDropped(key); }
    }
    for (const key of [...this.inflight.keys()]) {
      if (!wantedKeys.has(key)) this.cancel(key);
    }
  }

  /** Envoie aux workers autant de tuiles que le plafond de concurrence l'autorise. */
  #pump() {
    while (this.inflight.size < this.maxConcurrent && this.queue.size > 0) {
      let bestKey = null, bestP = Infinity;
      for (const [key, item] of this.queue) {
        if (item.priority < bestP) { bestP = item.priority; bestKey = key; }
      }
      if (bestKey === null) break;

      const { desc } = this.queue.get(bestKey);
      this.queue.delete(bestKey);

      // Une tuile va toujours au meme worker : il garde sa surface reconstruite, et
      // n'a plus qu'a la rhabiller si seule la photo change. La repartition reste
      // egale, les clefs se distribuant uniformement.
      let hash = 0;
      for (let k = 0; k < bestKey.length; k++) hash = (hash * 31 + bestKey.charCodeAt(k)) >>> 0;
      const w = this.workers[hash % this.workers.length];
      w.pending++;
      this.inflight.set(bestKey, { worker: w, desc });
      w.postMessage({ type: 'load', id: bestKey, ...desc });
    }
  }

  /** A appeler une fois la selection de l'image terminee. */
  flush() { this.#pump(); }

  get pending() { return this.queue.size + this.inflight.size; }

  dispose() {
    this.cancelAll();
    for (const w of this.workers) w.terminate();
    this.workers.length = 0;
  }
}
