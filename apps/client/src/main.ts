async function bootstrap(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('Canvas #game-canvas not found');

  // Verifica WebGPU
  if (!navigator.gpu) {
    document.body.innerHTML = '<h1>Seu navegador não suporta WebGPU. Atualize para Chrome 113+ ou Firefox 121+.</h1>';
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter');

  // Inicializa renderer (será expandido na Task 4)
  console.info('[bootstrap] WebGPU adapter acquired', adapter.info ?? {});
}

bootstrap().catch((err) => {
  console.error('[bootstrap] failed', err);
});
