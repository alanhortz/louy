import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { entropy } from './build/entropy/plugin.ts';
import { supportGate } from './build/support-gate.ts';

export default defineConfig({
  plugins: [react(), supportGate(), entropy('Alan Hortz')],
  build: {
    target: 'es2022',
    sourcemap: false,
    rolldownOptions: {
      output: {
        // Les bibliothèques changent rarement : isolées, elles restent en cache
        // chez le visiteur quand seul le code de l'application est redéployé.
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three/ },
            { name: 'vendor', test: /node_modules/ },
          ],
        },
      },
    },
  },
  worker: { format: 'es' },
});
