/**
 * A frota do jogador: o que é salvo, o que é mostrado, o que falha.
 *
 * Dois defeitos motivaram estes testes:
 *
 *  - sem conta, salvar uma nave devolvia um id inventado e não gravava
 *    nada: o jogador montava a nave, via "salvo" e a perdia no instante
 *    seguinte;
 *  - com a API fora do ar, a lista caía nos modelos padrão em SILÊNCIO —
 *    o jogador via "Cruzador Explorer Alpha" no lugar da própria frota e
 *    concluía que as naves tinham sumido. O hangar já tem tela de erro
 *    com "tentar novamente"; ela só não era alcançada.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PRESET_LOADOUTS,
  deleteLoadout,
  listLoadouts,
  saveLoadout,
} from '../src/persistence/loadoutRepo.js';

/**
 * Armazenamento de mentira: o ambiente de teste tem `document` mas não
 * `localStorage`, então este caminho do código nunca tinha sido exercido.
 */
function armazenamentoFalso(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k); },
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
  } as Storage;
}

const NAVE = {
  name: 'Minha Nave',
  slots: [{ slotId: 1, templateId: 'railgun_s', tier: 1 }],
};

function respostaJson(status: number, corpo: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpo,
  } as Response;
}

describe('frota sem conta', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', armazenamentoFalso());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a nave salva por um visitante sobrevive', async () => {
    const salva = await saveLoadout(NAVE);
    expect(salva.id).toMatch(/^local_/);
    const lista = await listLoadouts();
    expect(lista.map((l) => l.name)).toContain('Minha Nave');
  });

  it('a nave salva aparece antes dos modelos padrão', async () => {
    await saveLoadout(NAVE);
    const lista = await listLoadouts();
    expect(lista[0]?.name).toBe('Minha Nave');
    expect(lista.length).toBe(DEFAULT_PRESET_LOADOUTS.length + 1);
  });

  it('dá para apagar a nave do visitante', async () => {
    const salva = await saveLoadout(NAVE);
    await deleteLoadout(salva.id);
    const lista = await listLoadouts();
    expect(lista.map((l) => l.name)).not.toContain('Minha Nave');
  });

  it('apagar um modelo padrão não faz nada', async () => {
    await expect(deleteLoadout('preset_explorer')).resolves.toBeUndefined();
    expect(await listLoadouts()).toHaveLength(DEFAULT_PRESET_LOADOUTS.length);
  });

  it('sem nada salvo, mostra só os modelos padrão', async () => {
    expect(await listLoadouts()).toEqual(DEFAULT_PRESET_LOADOUTS);
  });
});

describe('frota com conta', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', armazenamentoFalso());
    localStorage.setItem('token', 'um-token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a frota do servidor é o que aparece', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respostaJson(200, {
          loadouts: [
            { id: '7', name: 'Cruzador', data: { slots: [] }, createdAt: 0, updatedAt: 0 },
          ],
        }),
      ),
    );
    const lista = await listLoadouts();
    expect(lista.map((l) => l.name)).toEqual(['Cruzador']);
  });

  it('frota vazia cai nos modelos padrão', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaJson(200, { loadouts: [] })));
    expect(await listLoadouts()).toEqual(DEFAULT_PRESET_LOADOUTS);
  });

  it('falha do servidor VAI À TELA em vez de virar modelo padrão', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respostaJson(500, { statusCode: 500, code: 'ECONNREFUSED', error: 'Internal Server Error' }),
      ),
    );
    await expect(listLoadouts()).rejects.toThrow(/serviços de dados/i);
  });

  it('sessão expirada avisa e limpa o token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaJson(401, { error: 'unauthorized' })));
    await expect(listLoadouts()).rejects.toThrow(/sessão expirada/i);
    expect(localStorage.getItem('token')).toBeNull();
  });

  it('rede fora do ar também chega à tela', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(listLoadouts()).rejects.toThrow();
  });

  it('sem armazenamento nenhum, o hangar ainda abre', async () => {
    // Modo privado, ou um contexto sem `localStorage`: ler direto lançava
    // e derrubava a tela inteira.
    vi.unstubAllGlobals();
    vi.stubGlobal('localStorage', undefined);
    expect(await listLoadouts()).toEqual(DEFAULT_PRESET_LOADOUTS);
  });
});
