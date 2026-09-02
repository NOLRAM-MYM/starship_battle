/**
 * Smoke test (Task 5.5): garante que o entrypoint `src/main.ts` pode
 * ser importado sem erro imediato de import / parse / dependência.
 *
 * O `bootstrap()` em main.ts é fire-and-forget (`bootstrap().catch(...)`),
 * então qualquer erro de runtime dentro dele (ex.: canvas ausente,
 * WebGPU não suportado) só é logado — não propaga no import.
 *
 * Ambiente: `happy-dom` (configurado em `vite.config.ts`).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Smoke (Task 5.5)', () => {
  beforeEach(() => {
    // Sem WebGPU no jsdom-like → main.ts vai sair cedo, mas o import
    // em si tem que resolver. Mock o mínimo necessário para que o
    // módulo não exploda no top-level.
    Object.defineProperty(globalThis.navigator, 'gpu', {
      configurable: true,
      writable: true,
      value: { requestAdapter: () => null },
    });

    // Silencia o `console.error` disparado pelo `.catch` do bootstrap
    // (canvas ausente em ambiente de teste, etc.).
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Garante fresh state: limpa o module cache do Vitest antes de
    // cada teste para que o `import('../src/main.js')` reavalie o módulo.
    vi.resetModules();
  });

  // Timeout generoso: importar `main.ts` puxa o grafo inteiro do
  // `three/webgpu` mais renderers, HUD e telas. Numa máquina ocupada
  // isso passa dos 5s padrão do vitest, e o teste falhava por tempo
  // sem haver nada de errado com o código.
  it('imports src/main.ts without throwing', async () => {
    await expect(import('../src/main.js')).resolves.toBeDefined();
  }, 60_000);
});
