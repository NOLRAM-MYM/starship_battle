import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: { port: 5173, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
  },
});
