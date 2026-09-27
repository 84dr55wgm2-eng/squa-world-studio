import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Configuration de production pour un hébergement statique (Vercel ou équivalent).
// - base '/' : l'application est servie à la racine du domaine.
// - Les bibliothèques lourdes sont séparées en fichiers distincts : quand seul le code
//   de l'éditeur change, le navigateur garde Three.js / React en cache.
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    // Fichiers générés (noms hachés) dans /_app/, séparés de public/assets/ (modèles de la bibliothèque,
    // noms stables) : les premiers peuvent être mis en cache pour toujours, pas les seconds.
    assetsDir: '_app',
    target: 'es2022',
    sourcemap: false,
    // Three.js pèse ~700 ko minifié à lui seul : l'avertissement par défaut (500 ko) n'est pas pertinent ici.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/three/') || id.includes('three-stdlib')) return 'vendor-three';
          if (id.includes('@react-three')) return 'vendor-r3f';
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'vendor-react';
          return 'vendor';
        },
      },
    },
  },
});
