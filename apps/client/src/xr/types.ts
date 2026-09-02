/**
 * Re-exports vazio. Os tipos WebXR (XRSession, XRSystem, XRFrame, ...)
 * já vêm do `lib.dom.d.ts` do TypeScript 5.6+ e do `@webgpu/types`.
 *
 * Este arquivo existe apenas para satisfazer a Task 5.1, que sugere
 * centralizar as declarações caso `happy-dom` (ambiente de teste) não
 * as exponha. Como elas já estão disponíveis globalmente, mantemos
 * o módulo vazio para servir de ponto único de import se necessário
 * no futuro.
 */

export {};
