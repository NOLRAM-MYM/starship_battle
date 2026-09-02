import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  // `host` explícito: sem ele o Vite segue a resolução de `localhost`,
  // que nesta máquina alterna entre 127.0.0.1 e ::1 a cada subida — o
  // servidor mudava de endereço sozinho e o navegador batia em
  // ERR_CONNECTION_REFUSED sem nada ter mudado no código.
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'happy-dom',
    globals: true,
  },
});
