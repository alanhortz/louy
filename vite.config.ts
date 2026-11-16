import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { AIRCRAFT_EDGE_PATH, aircraftFeedUrl } from './src/domain/aircraft.ts';
import { cameraSourceUrl } from './src/domain/cameraView.ts';
import { routeUrl } from './src/domain/flightRoute.ts';
import { vesselPageUrl } from './src/domain/vessels.ts';
import { entropy } from './build/entropy/plugin.ts';
import { supportGate } from './build/support-gate.ts';

export default defineConfig({
  plugins: [react(), supportGate(), entropy('Alan Hortz')],
  build: {
    target: 'es2022',
    sourcemap: false,
    // Aucun fichier incorporé en `data:` : la politique de sécurité du site
    // (`font-src 'self'`) refuserait une police ainsi incorporée.
    assetsInlineLimit: 0,
    rolldownOptions: {
      output: {
        // Les bibliothèques changent rarement : isolées, elles restent en cache
        // chez le visiteur quand seul le code de l'application est redéployé.
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three/ },
            // moteur de splats : chargé à la demande, jamais avec le reste des bibliothèques
            { name: 'spark', test: /node_modules[\\/]@sparkjsdev/ },
            { name: 'vendor', test: /node_modules/ },
          ],
        },
      },
    },
  },
  worker: { format: 'es' },
  server: {
    // En développement il n'y a pas de Worker : ce relais tient lieu du sien pour les avions,
    // le réseau adsb.lol n'autorisant pas les appels directs depuis un navigateur.
    proxy: {
      [`/edge/v1${AIRCRAFT_EDGE_PATH}`]: {
        target: new URL(aircraftFeedUrl()).origin,
        changeOrigin: true,
        rewrite: () => new URL(aircraftFeedUrl()).pathname,
      },
      // bateaux : même rôle, vers EuRIS, qui n'autorise pas non plus les appels d'un navigateur
      '^/edge/v1/vessels/(0|100|200|300)\\.json$': {
        target: new URL(vesselPageUrl(0)).origin,
        changeOrigin: true,
        rewrite: (path) => { const url = new URL(vesselPageUrl(Number(path.split('/').pop()!.replace('.json', '')))); return url.pathname + url.search; },
      },
      // image d'une caméra routière : même rôle, vers Trafiroutes, pour que le viewer puisse en lire les pixels
      '^/edge/v1/cameras/\\d{1,3}\\.jpg(\\?.*)?$': {
        target: new URL(cameraSourceUrl('0')).origin,
        changeOrigin: true,
        rewrite: (path) => new URL(cameraSourceUrl(path.split('?')[0]!.split('/').pop()!.replace('.jpg', ''))).pathname,
      },
      // liaison d'un vol : même rôle, vers la base adsbdb
      '^/edge/v1/aircraft/route/[A-Z0-9]{3,8}\\.json$': {
        target: new URL(routeUrl('X')).origin,
        changeOrigin: true,
        rewrite: (path) => new URL(routeUrl(path.split('/').pop()!.replace('.json', ''))).pathname,
      },
    },
  },
});
