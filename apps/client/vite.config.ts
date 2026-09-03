import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  // `::` e não `localhost` nem `127.0.0.1`.
  //
  // Sem `host`, o Vite segue a resolução de `localhost`, que nesta
  // máquina alterna entre 127.0.0.1 e ::1 a cada subida: o servidor
  // mudava de endereço sozinho e o navegador batia em
  // ERR_CONNECTION_REFUSED sem nada ter mudado no código.
  //
  // Fixar em `127.0.0.1` resolveu isso e criou outro: `localhost`
  // resolve para ::1 PRIMEIRO, e abrir `http://localhost:5173` passava
  // a cair num endereço onde não havia ninguém ouvindo.
  //
  // `::` abre o socket em dual-stack no Node — atende ::1 e 127.0.0.1
  // ao mesmo tempo —, que é o mesmo que a API já faz. Vale o mesmo
  // aviso de sempre: isto é um servidor de desenvolvimento, e em
  // dual-stack ele fica acessível pela rede local.
  server: { host: '::', port: 5173, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'happy-dom',
    globals: true,
  },
});
