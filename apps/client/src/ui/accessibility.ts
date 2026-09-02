/**
 * Helpers de acessibilidade.
 *
 * - `applyAccessibility` aplica classes CSS + escala de fonte no
 *   `<html>` conforme `ClientSettings`.
 * - `colorblindFilterSvg` retorna o id de filtro SVG correspondente
 *   ao modo daltonismo. Os filtros em si ficam no DOM do jogo; este
 *   helper apenas resolve a string para uso em `filter: url(...)`.
 */

import { applySettings, type ClientSettings } from './settings.js';

export function applyAccessibility(s: ClientSettings): void {
  applySettings(s);
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!root) return;
  const scale = Number.isFinite(s.fontScale) && s.fontScale > 0 ? s.fontScale : 1.0;
  root.style.fontSize = `${scale * 16}px`;
}

export type ColorblindFilterMode = 'off' | 'protanopia' | 'deuteranopia' | 'tritanopia';

export function colorblindFilterSvg(mode: ColorblindFilterMode): string {
  if (mode === 'off') return 'none';
  return `url(#cb-${mode})`;
}
