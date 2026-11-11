/// <reference types="vite/client" />

/** Table de graines générée à la construction (voir `build/entropy`). */
declare module 'virtual:entropy' {
  export const ENTROPY: readonly number[];
}

interface ImportMetaEnv {
  readonly VITE_TILE_ENDPOINT?: 'edge' | 'direct';
}
