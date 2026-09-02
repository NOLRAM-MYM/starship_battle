# ADR-0002: Escala do servidor multiplayer (protocolo v3)

- **Status:** aceito
- **Data:** 2026-09-01
- **Contexto:** ADR-0001 definiu o servidor autoritativo em Rust. Este ADR
  trata de quantos jogadores simultâneos ele aguenta.

## Contexto

O caminho de rede da v2 funcionava com poucos jogadores conectados e
degradava de forma não-linear conforme a arena enchia. Quatro problemas
mediam-se direto no código:

1. **Snapshot O(jogadores x entidades).** `build_snapshot` montava o mundo
   inteiro e `broadcast` **clonava a `SnapshotData` inteira por cliente**,
   depois **serializava de novo para cada um**. Com 50 jogadores e 500
   entidades, eram 50 clones de um `Vec` de 500 structs (cada uma com um
   `String` de nome) mais 50 passagens de bincode — 20 vezes por segundo.

2. **Entidades estáticas retransmitidas para sempre.** Asteroides,
   anomalias e destroços não se movem, mas iam em todo snapshot, a 20Hz,
   enquanto existissem. Era a maior fatia da banda, e a mais inútil.

3. **Lock global do mundo por mensagem de input.** `set_player_input`
   tomava `world.write().await` a cada `ClientMsg::Input`. A 30Hz por
   jogador, são 30·N aquisições exclusivas por segundo disputando com o
   próprio loop de simulação. Pior: dentro do lock, `set_input` **varria
   todas as naves** procurando a do jogador — O(30·N²) comparações/s.

4. **Filas ilimitadas.** `mpsc::unbounded_channel` por cliente: um jogador
   com conexão ruim acumulava snapshots até derrubar o processo por
   memória. É o modo de falha clássico de servidor de jogo.

Havia ainda `check_projectile_collisions` em O(projéteis x naves) e um
`listener.accept()` cujo erro propagava com `?`, derrubando o listener
inteiro por causa de uma conexão malformada.

## Decisão

### 1. Serializar uma vez, compartilhar bytes

`ClientHandle` passou a carregar `mpsc::Sender<Arc<Vec<u8>>>`. O broadcast
codifica **uma vez** e entrega um `Arc` clonado a cada cliente. O custo por
cliente extra caiu de "clonar + serializar o mundo" para "clonar um
ponteiro".

### 2. Separar estático de dinâmico (protocolo v3)

O snapshot de 20Hz carrega apenas naves, projéteis e NPCs. Asteroides,
anomalias e destroços vão numa mensagem nova, `WorldChunk`, enviada
**uma vez por entidade**, quando ela entra no raio de interesse do
jogador, com uma lista `expired` para o que saiu.

Isso quebra compatibilidade — daí `PROTOCOL_VERSION = 3`, com o servidor
recusando `Join` de cliente em versão diferente em vez de deixá-lo
interpretar bytes com outro layout.

### 3. Área de interesse (AOI) com histerese

Cada cliente recebe apenas o que está dentro de `AOI_RADIUS` (1200u) da
sua nave. A saída usa `AOI_RADIUS + AOI_HYSTERESIS` (200u): sem essa
margem, uma entidade parada exatamente na borda entraria e sairia da visão
a cada tick, gerando retransmissão infinita.

A serialização passa a ser por cliente (o conteúdo difere), mas sobre um
conjunto pequeno e local — em vez de uma cópia do mundo inteiro.

### 4. Fila de comandos em vez de lock por mensagem

O handler WebSocket não toca mais no mundo: traduz frames em
`PlayerCommand` e empurra numa fila limitada. O loop de simulação drena
tudo uma vez por tick, **sob o único write lock que já tomava**. `Ping`
continua respondido no handler — passar pela fila distorceria a medição
de RTT.

Junto veio o índice `player_ships: HashMap<u32, EntityId>`, trocando a
varredura linear do `set_input` por lookup direto.

### 5. Filas limitadas com política de descarte

Fila de 32 frames por cliente (~1,6s a 20Hz). Ao encher, o frame é
descartado: snapshot é **estado**, não evento — o próximo já corrige.
Após 60 descartes consecutivos o cliente é removido. Assim um jogador
travado degrada sozinho, sem consumir memória do shard inteiro.

### 6. Grade espacial para colisões

Naves são indexadas em células de 32u (maior que a soma dos maiores raios
de colisão, o que garante que nenhum par colidindo escape da vizinhança
3x3x3 testada). O custo passa a depender da densidade local.

## Consequências

**Positivas**

- Banda por jogador deixou de crescer com o tamanho do setor.
- Memória por cliente é limitada por construção.
- Input não disputa mais lock com a simulação.
- Um erro de `accept` ou um cliente lento não afetam os demais.

**Negativas / custos aceitos**

- **Quebra de compatibilidade:** clientes v2 são recusados no `Join`.
- **Serialização por cliente no AOI.** Clientes próximos recalculam
  conteúdo parecido. Se isso virar gargalo, o próximo passo é agrupar
  clientes por célula de grade e compartilhar o frame dentro do grupo.
- **Estado por cliente no servidor:** `known_static` guarda os ids já
  enviados. É um `HashSet` por conexão — pequeno, mas não zero.
- **Descarte silencioso de snapshot** para cliente lento. Preferido a
  crescer a fila, mas significa que um jogador com rede ruim vê o mundo
  "pular" em vez de atrasar suavemente.

## Alternativas consideradas

- **Delta compression** (mandar só o que mudou desde o último ack). Ganho
  maior que AOI, custo bem mais alto: exige histórico por cliente e
  reconciliação de acks. AOI dá a maior parte do benefício com uma
  fração da complexidade. Fica como próximo passo natural.
- **Manter tudo no snapshot e só comprimir** (zstd no frame). Reduz bytes
  na rede mas não o custo de CPU de montar e serializar N vezes, que era
  o gargalo medido.
- **Sharding por setor** (vários processos). Resolve escala além do que um
  processo aguenta, mas é ortogonal: sem AOI, cada shard continuaria
  gastando banda O(N x M) internamente.

## Verificação

`crates/game-server/tests/aoi_scaling.rs` cobre: filtragem por raio,
ausência de estáticos no snapshot dinâmico, coerência da histerese,
roteamento de input pelo índice, limpeza no despawn e paridade da colisão
por grade. `state.rs` testa a política de descarte (cliente que não drena
é removido; cliente que drena permanece).

## Não feito

- Medição de carga real com N jogadores. Os números deste ADR são
  análise de complexidade do código, não benchmark. Um teste de carga
  (previsto no plano mestre) é o que vai dizer o teto real por shard.
- Rate limiting por conexão no `ClientMsg::Input`. A fila limitada evita
  o pior caso de memória, mas um cliente malicioso ainda pode gastar CPU
  de desserialização.
