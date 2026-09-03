/**
 * Consumíveis: espelho do catálogo do servidor, só para a INTERFACE.
 *
 * A fonte de verdade é `crates/sim-core/src/ship/consumables.rs` — é lá
 * que se decide quanto cura e quanto espera. O que existe aqui são os
 * nomes e o número de slots, para o hangar mostrar o que está equipado e
 * o HUD rotular as teclas 4 e 5.
 *
 * Antes disto o jogador comprava um Kit de Reparo na loja e não havia
 * nada, em lugar nenhum do jogo, indicando que ele existia: nem no
 * hangar, nem no HUD, nem uma tecla para usar.
 */

/** Slots que a nave leva para a arena. Bate com `MAX_SLOTS` em Rust. */
export const MAX_CONSUMABLE_SLOTS = 2;

export interface ConsumableUiInfo {
  /** Nome curto, para o slot do HUD. */
  nome: string;
  /** O que faz, em uma linha, para o hangar. */
  descricao: string;
  /** Índice do efeito visual, igual ao do servidor. */
  vfx: number;
}

const CONSUMIVEIS: Record<string, ConsumableUiInfo> = {
  repair_kit: {
    nome: 'Kit Reparo',
    descricao: 'Restaura casco na hora. A skill de Reparo cura devagar; a carga é imediata.',
    vfx: 0,
  },
  decoy_flare: {
    nome: 'Iscas',
    descricao: 'Confunde o rastreador de um torpedo. A saída sem gastar a dobra.',
    vfx: 2,
  },
  shield_cell: {
    nome: 'Célula Escudo',
    descricao: 'Recarrega o escudo na hora, sem esperar a regeneração.',
    vfx: 1,
  },
};

export function consumableUiInfo(templateId: string): ConsumableUiInfo | undefined {
  return CONSUMIVEIS[templateId];
}

/** Ids conhecidos, para os testes de paridade com o servidor. */
export function consumableIds(): string[] {
  return Object.keys(CONSUMIVEIS);
}

/** Uma carga equipada, como vai no `Join`. */
export interface EquippedConsumable {
  templateId: string;
  charges: number;
  nome: string;
}

/**
 * Entrada de inventário, como a API realmente a devolve.
 *
 * Repare que NÃO há `code` aqui: `/economy/inventory` devolve apenas
 * `{ accountId, itemId, quantity }`. O nome do template vive no catálogo
 * (`/economy/items`), e é preciso juntar os dois. A primeira versão
 * disto lia `linha.code` e teria produzido um cinto sempre vazio, sem
 * erro nenhum aparecendo.
 */
export interface InventoryLike {
  itemId: number | string;
  quantity: number;
}

/**
 * Catálogo mínimo para resolver `itemId` -> `code`.
 *
 * O `id` aceita string porque é isso que a API devolve: o driver do
 * Postgres serializa BIGINT como string para não perder precisão. O
 * inventário, por outro lado, devolve `itemId` numérico. Comparar os
 * dois sem normalizar faz a busca falhar sempre — e em silêncio, que é
 * exatamente como o cinto saía vazio mesmo com kits comprados. É a
 * mesma armadilha que já tinha quebrado a exclusão de layouts.
 */
export interface CatalogLike {
  id: number | string;
  code: string;
}

/**
 * Escolhe o que levar para a arena a partir do inventário da conta.
 *
 * Leva automaticamente, sem tela de seleção: o jogador comprou o item
 * para usá-lo, e obrigá-lo a equipar num terceiro lugar seria mais uma
 * etapa entre a compra e o efeito. Com mais de dois tipos, os dois
 * primeiros entram — e o hangar mostra quais são.
 *
 * Ids desconhecidos e quantidades zeradas são descartados aqui, do mesmo
 * jeito que o servidor faz: as duas pontas concordam sobre o que é um
 * cinto válido.
 */
export function equippedFromInventory(
  inventario: readonly InventoryLike[],
  catalogo: readonly CatalogLike[],
): EquippedConsumable[] {
  const codePorId = new Map(catalogo.map((i) => [Number(i.id), i.code]));
  const out: EquippedConsumable[] = [];
  for (const linha of inventario) {
    if (out.length >= MAX_CONSUMABLE_SLOTS) break;
    const code = codePorId.get(Number(linha.itemId));
    if (!code) continue;
    const info = CONSUMIVEIS[code];
    if (!info) continue;
    const qtd = Math.floor(linha.quantity ?? 0);
    if (qtd <= 0) continue;
    out.push({ templateId: code, charges: qtd, nome: info.nome });
  }
  return out;
}
