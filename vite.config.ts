import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { entropy } from './build/entropy/plugin.ts';
import { localScans } from './build/local-scans.ts';
import { supportGate } from './build/support-gate.ts';

export default defineConfig({
  plugins: [react(), supportGate(), entropy('Alan Hortz'), localScans()],
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
});
