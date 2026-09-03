//! Tipos de mensagem trocados entre cliente e servidor.
//! Codificados com bincode para baixa banda.

use serde::{Deserialize, Serialize};

/// Versão do protocolo. Incrementar em mudanças incompatíveis.
///
/// v3: o snapshot periódico deixou de carregar entidades estáticas
/// (asteroides/anomalias/destroços). Elas chegam uma única vez em
/// `WorldChunk` quando entram no raio de interesse do jogador. Ver
/// `docs/architecture/0002-multiplayer-scaling.md`.
///
/// v4: `Input` ganhou `pitch` e `roll`. Até a v3 a nave só fazia yaw —
/// ela deslizava num plano horizontal e não havia como subir, descer
/// nem inclinar. Ver `docs/architecture/0004-flight-model.md`.
///
/// v5: `Join` carrega o loadout (ids de componente) para o servidor
/// derivar dano/escudo/empuxo, e o `Welcome` passa a vir seguido de
/// `Sector` com os corpos celestes que exercem gravidade.
///
/// v6: `Input` ganhou `fire_charge` (tiro carregado) e o mundo ganhou
/// vórtices de dobra como tipo de entidade.
pub const PROTOCOL_VERSION: u16 = 11;

/// Identificadores de efeito visual em `ServerMsg::Vfx`.
///
/// São `u8` no fio; o cliente mapeia cada um para um efeito de
/// partículas. Ficam aqui para os dois lados lerem a MESMA lista.
pub const VFX_MUZZLE: u8 = 1;
pub const VFX_IMPACT: u8 = 2;
pub const VFX_EXPLOSION_SHIP: u8 = 3;
pub const VFX_EXPLOSION_LARGE: u8 = 4;
/// Pulso eletromagnético: onda de choque expandindo.
pub const VFX_EMP: u8 = 5;
/// Iscas de dispersão soltas: cintilação que confunde rastreadores.
pub const VFX_DECOY: u8 = 6;
// Não há VFX para Reparo nem para Dobra: as duas são animações PRESAS À
// NAVE, e `SkillActivated` já carrega o `entity_id`, então o cliente
// consegue ancorá-las na nave certa e acompanhá-la enquanto ela se move.
// Uma mensagem `Vfx` leva só uma posição, que congelaria o efeito no
// ponto onde a habilidade foi acionada. O PEM é a exceção porque a onda
// de choque de fato nasce num ponto fixo do espaço.

/// Raio de interesse (AOI) padrão, em unidades de mundo.
///
/// Só entidades dentro deste raio entram no snapshot de um jogador. Sem
/// isso a banda cresce com O(jogadores x entidades) — o gargalo que
/// derruba o servidor quando a arena enche.
pub const AOI_RADIUS: f32 = 1_200.0;

/// Margem de histerese do AOI. Uma entidade só é removida da visão do
/// cliente ao passar de `AOI_RADIUS + AOI_HYSTERESIS`, evitando que algo
/// exatamente na borda entre e saia a cada tick (flicker + retransmissão).
pub const AOI_HYSTERESIS: f32 = 200.0;
/// Frequência do tick de simulação (Hz).
pub const TICK_RATE_HZ: u32 = 30;

/// Frequência de snapshot (Hz), anunciada ao cliente no `Welcome` e
/// usada por ele para interpolar entre estados.
///
/// Precisa dividir `TICK_RATE_HZ` exatamente: o loop envia snapshot a
/// cada `SNAPSHOT_EVERY_N_TICKS`. Antes esta constante dizia 20 enquanto
/// o loop enviava a cada 2 ticks de 30Hz — ou seja, 15Hz reais. O
/// cliente interpolava contra um intervalo 33% menor que o verdadeiro,
/// o que aparece como movimento aos solavancos.
pub const SNAPSHOT_RATE_HZ: u32 = 15;

/// Quantos ticks de simulação entre dois snapshots. Derivado para que as
/// duas constantes não possam divergir de novo.
pub const SNAPSHOT_EVERY_N_TICKS: u64 = (TICK_RATE_HZ / SNAPSHOT_RATE_HZ) as u64;

// Falha na compilação se as frequências deixarem de ser divisíveis.
const _: () = assert!(TICK_RATE_HZ.is_multiple_of(SNAPSHOT_RATE_HZ));
/// Frequência sugerida de input do cliente (Hz).
#[allow(dead_code)]
pub const INPUT_RATE_HZ: u32 = 30;

/// Mensagem do cliente para o servidor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ClientMsg {
    /// Handshake inicial.
    ///
    /// `loadout` traz apenas os `templateId` equipados, em ordem de
    /// slot. O servidor resolve os NÚMEROS (dano, escudo, empuxo) no seu
    /// próprio catálogo — o cliente nunca envia valores, então não tem
    /// como inflar o próprio dano.
    Join {
        name: String,
        protocol: u16,
        loadout: Vec<String>,
        /// Nós da árvore de skills desbloqueados pela conta.
        ///
        /// Vêm do cliente pelo mesmo motivo do `loadout`: o servidor de
        /// jogo não fala com o banco. E pela mesma razão são seguros —
        /// são apenas IDS. Quem converte id em número é o servidor
        /// (`sim_core::ship::skills`), então inventar um id não rende
        /// nada, e inventar um id real só dá o bônus que a conta
        /// deveria ter (a API é quem valida a compra do nó).
        skills: Vec<String>,
        /// Consumíveis levados para a arena, com as cargas.
        ///
        /// Vêm do inventário da conta. O servidor descarta ids que não
        /// conhece e limita o número de slots, então declarar cargas a
        /// mais não rende nada além do que o cinto aceita.
        consumables: Vec<sim_core::ship::consumables::ConsumableSlot>,
        /// Entrar no CAMPO DE PROVAS: o servidor cria alvos de treino ao
        /// redor da nave.
        ///
        /// Existe porque verificar as mecânicas exigia dois jogadores
        /// humanos coordenados, e mesmo assim o encontro era aleatório.
        /// Sem um adversário confiável, mira, torpedo e defesas só
        /// podiam ser testados em teste unitário.
        practice: bool
    },
    /// Input contínuo (enviado a ~30Hz).
    Input {
        /// -1..=1 (yaw esquerda/direita).
        steer: f32,
        /// -1..=1 (pitch: nariz para cima/baixo).
        pitch: f32,
        /// -1..=1 (roll: inclinação sobre o eixo longitudinal).
        roll: f32,
        /// 0..=1 (thrust para frente).
        thrust: f32,
        /// Disparo de arma primária.
        fire: bool,
        /// Segundos que o gatilho ficou segurado antes de soltar.
        ///
        /// O servidor é quem decide o efeito: ele conhece o tempo de
        /// carga da arma equipada e satura o valor. O cliente só relata
        /// quanto tempo o jogador segurou.
        fire_charge: f32,
        /// Habilidade solicitada neste tick.
        skill: Option<sim_core::skills::ActiveSkill>,
        /// Slot de consumível a usar neste tick (0 ou 1).
        ///
        /// Só o índice: o servidor sabe o que está em cada slot e
        /// quantas cargas restam. Mandar o id do item daqui deixaria o
        /// cliente escolher o efeito.
        use_consumable: Option<u8>,
        /// Entidade contra a qual lançar um torpedo neste tick.
        ///
        /// O cliente só PEDE: o servidor confere lançador equipado,
        /// cooldown e alcance de travamento antes de criar qualquer
        /// coisa.
        launch_torpedo: Option<u32>,
        /// Soltar iscas de dispersão neste tick.
        deploy_decoys: bool,
    },
    /// Heartbeat (liveness).
    Ping { nonce: u32 },
}

/// Mensagem do servidor para o cliente.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ServerMsg {
    /// Resposta ao Join, atribui player_id.
    Welcome {
        player_id: u32,
        protocol: u16,
        tick_rate: u32,
        /// Setor inicial: seed + bounding box + summary de objetos.
        world_seed: u32,
    },
    /// Snapshot das entidades dinâmicas visíveis ao player (20Hz).
    Snapshot(SnapshotData),
    /// Corpos celestes do setor, enviados uma vez após o `Welcome`.
    ///
    /// São cenário fixo com massa: exercem gravidade e destroem quem
    /// colide. Vêm do servidor (e não gerados no cliente) para que os
    /// dois lados concordem sobre onde cada planeta está.
    Sector {
        bodies: Vec<sim_core::worldgen::celestial::CelestialBody>,
        /// Constante gravitacional em vigor no shard.
        ///
        /// Enviada em vez de o cliente codificá-la fixa: a previsão de
        /// trajetória usa a MESMA fórmula do servidor, e um valor
        /// diferente dos dois lados daria uma curva bonita e errada,
        /// sem nenhum erro visível.
        gravity_constant: f32,
        /// Arrasto linear da nave do jogador, para a previsão bater com
        /// a física real.
        ship_drag: f32,
    },
    /// Lote de entidades estáticas que acabaram de entrar no raio de
    /// interesse do jogador. Enviado uma única vez por entidade, não a
    /// cada tick: asteroides e anomalias não se movem, então reenviá-los
    /// 20x por segundo era banda pura desperdiçada.
    WorldChunk(WorldChunkData),
    /// Entidade foi destruída (HP=0, TTL expirado, etc).
    EntityDestroyed { entity_id: u32 },
    /// XP ganho (solo ou compartilhado em party).
    XpGained { amount: u32, reason: String },
    /// Uma skill ativa foi disparada por alguma entidade.
    SkillActivated { entity_id: u32, skill: sim_core::skills::ActiveSkill },
    /// Um efeito visual efêmero deve ser tocado no cliente.
    Vfx { effect_id: u8, pos: [f32; 3] },
    /// Resposta a Ping.
    Pong { nonce: u32 },
    /// Erro de protocolo.
    Error { reason: String },
    /// Consumível usado por uma nave.
    ///
    /// Acrescentada no FIM do enum para não deslocar as discriminantes
    /// anteriores. Carrega `charges_left` porque o servidor é quem
    /// decide se o uso valeu (cooldown, carga zerada); um contador
    /// mantido só no cliente divergiria na primeira recusa.
    ConsumableUsed { entity_id: u32, slot: u8, vfx: u8, charges_left: u32 },
    /// Um torpedo perdeu a trava.
    ///
    /// `reason`: 0 = alvo rápido demais (dobra), 1 = iscas, 2 = fora de
    /// alcance. O alvo precisa saber QUAL defesa funcionou, senão não
    /// aprende qual usar da próxima vez.
    TorpedoLockLost { torpedo_id: u32, reason: u8 }
}

/// Lote de entidades estáticas (asteroides, anomalias, destroços).
///
/// Complementa `Snapshot`: o cliente acumula estes registros e só os
/// descarta ao receber `EntityDestroyed` ou `WorldChunkExpire`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorldChunkData {
    /// Tick em que o lote foi gerado.
    pub tick: u64,
    /// Entidades que entraram no raio de interesse agora.
    pub entities: Vec<EntityState>,
    /// Entidades que saíram do raio e podem ser liberadas pelo cliente.
    pub expired: Vec<u32>,
}

/// Dados de um snapshot. Serializado com bincode.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SnapshotData {
    /// Tick do servidor.
    pub tick: u64,
    /// Server time em ms desde epoch.
    pub server_time_ms: u64,
    /// Entidades visíveis (incluindo self).
    pub entities: Vec<EntityState>,
}

/// Estado serializado de uma entidade.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EntityState {
    pub id: u32,
    pub kind: EntityKind,
    pub pos: [f32; 3],
    pub rot: [f32; 4], // quaternion (x,y,z,w)
    pub vel: [f32; 3],
    /// HP ratio (0..=1). 0 = destruído. None = não aplicável.
    pub hp_ratio: Option<f32>,
    /// Nome exibido (ex.: player name).
    pub display_name: Option<String>,
    /// Payload específico por tipo (None para Ship/Projectile).
    pub payload: Option<EntityPayload>,
}

/// Tipo da entidade.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EntityKind {
    Ship,
    Projectile,
    Npc,
    Asteroid,
    Anomaly,
    Wreck,
    /// Vórtice de dobra: rastro que impulsiona quem entrar.
    Vortex,
    /// Torpedo teleguiado em voo.
    Torpedo,
}

/// Payload específico por tipo de entidade.
///
/// Cada variante carrega os dados que o cliente precisa para renderizar
/// e/ou interagir com a entidade. Em bincode, variantes não-padrão
/// ocupam apenas os campos relevantes (a discriminante é 1 byte).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum EntityPayload {
    /// NPC inimigo ou neutro.
    Npc(NpcPayload),
    /// Asteroide minerável.
    Asteroid(AsteroidPayload),
    /// Anomalia espacial (warp, radiação, well).
    Anomaly(AnomalyPayload),
    /// Destroço de nave com loot.
    Wreck(WreckPayload),
    /// Vórtice de dobra.
    Vortex(VortexPayload),
    /// Projétil em voo. Acrescentado no FIM: as variantes anteriores
    /// mantêm as discriminantes, então clientes v6 continuam lendo
    /// tudo o que já liam.
    Projectile(ProjectilePayload),
    /// Torpedo teleguiado.
    Torpedo(TorpedoPayload),
}

/// Payload de torpedo.
///
/// `locked` é o que o alvo precisa saber para decidir: um torpedo que
/// ainda persegue exige reação, um que perdeu a trava só precisa ser
/// evitado. Sem este campo as duas situações seriam idênticas na tela.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TorpedoPayload {
    /// Direção de voo, unitária.
    pub dir: [f32; 3],
    pub radius: f32,
    /// 0..1 — casco restante, para o alvo saber se vale atirar nele.
    pub hp_ratio: f32,
    /// `true` enquanto persegue alguém.
    pub locked: bool,
}

/// Payload de projétil.
///
/// Sem isto o cliente recebia só posição e velocidade e desenhava a
/// mesma esfera amarela para tudo: não dava para distinguir um toque de
/// laser de uma Lança Singular carregada 2,5s, nem ver que segurar o
/// gatilho tinha feito diferença. O dano continua sendo decidido só
/// pelo servidor — isto é aparência.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectilePayload {
    /// Família visual da arma (`WeaponVisual::to_index`).
    pub visual: u8,
    /// 0..1 — quanto da carga foi aproveitado no disparo.
    pub charge: f32,
    /// Raio de colisão real, já com o bônus de carga.
    pub radius: f32,
}

/// Payload de vórtice de dobra.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VortexPayload {
    /// Direção do impulso (unitária).
    pub dir: [f32; 3],
    pub radius: f32,
    /// 0..1 — potência restante, para o cliente esmaecer o efeito.
    pub strength: f32,
}

/// Payload de NPC.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NpcPayload {
    /// Arquétipo (pirata, minerador, patrulheiro, etc).
    pub archetype: u8,
    /// Estado da FSM (Idle, Patrol, Chase, Attack, Flee, Dead).
    pub ai_state: u8,
    /// Raio de colisão.
    pub radius: f32,
    /// Alvo atual (player_id ou outro entity_id). None se sem alvo.
    pub target_id: Option<u32>,
}

/// Payload de asteroide.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AsteroidPayload {
    /// Tipo (Rock, Iron, Gold, DarkMatter).
    pub kind: u8,
    /// Raio.
    pub radius: f32,
    /// Unidades de recurso restantes.
    pub resource_units: u32,
}

/// Payload de anomalia.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnomalyPayload {
    /// Tipo (Warp, Radiation, GravityWell).
    pub kind: u8,
    /// Raio do efeito.
    pub radius: f32,
    /// Intensidade (dps, força, etc).
    pub intensity: f32,
    /// ID do warp de destino (apenas para Warp).
    pub target_warp_id: Option<u32>,
}

/// Payload de wreck.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WreckPayload {
    /// ID do template de nave original.
    pub ship_template: String,
    /// Raio.
    pub radius: f32,
    /// TTL restante em ticks.
    pub ttl_remaining: u64,
    /// Número de entradas de loot.
    pub loot_count: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_msg_roundtrips() {
        let original = ClientMsg::Input {
            steer: 0.5,
            pitch: -0.25,
            roll: 0.75,
            thrust: 1.0,
            fire: true,
            fire_charge: 1.25,
            skill: Some(sim_core::skills::ActiveSkill::Emp),
            use_consumable: None,
            launch_torpedo: None,
            deploy_decoys: false,
        };
        let bytes = bincode::serialize(&original).unwrap();
        let decoded: ClientMsg = bincode::deserialize(&bytes).unwrap();
        assert_eq!(original, decoded);
    }

    #[test]
    fn server_msg_welcome_roundtrips() {
        let original = ServerMsg::Welcome {
            player_id: 42,
            protocol: 2,
            tick_rate: 20,
            world_seed: 0xC0FFEE,
        };
        let bytes = bincode::serialize(&original).unwrap();
        let decoded: ServerMsg = bincode::deserialize(&bytes).unwrap();
        assert_eq!(original, decoded);
    }

    #[test]
    fn server_msg_skill_activated_roundtrips() {
        let original = ServerMsg::SkillActivated {
            entity_id: 10,
            skill: sim_core::skills::ActiveSkill::Dash,
        };
        let bytes = bincode::serialize(&original).unwrap();
        let decoded: ServerMsg = bincode::deserialize(&bytes).unwrap();
        assert_eq!(original, decoded);
    }

    #[test]
    fn server_msg_vfx_roundtrips() {
        let original = ServerMsg::Vfx {
            effect_id: 1, // Ex: Explosão
            pos: [1.0, 2.0, 3.0],
        };
        let bytes = bincode::serialize(&original).unwrap();
        let decoded: ServerMsg = bincode::deserialize(&bytes).unwrap();
        assert_eq!(original, decoded);
    }

    #[test]
    fn snapshot_roundtrips() {
        let original = ServerMsg::Snapshot(SnapshotData {
            tick: 100,
            server_time_ms: 5_000,
            entities: vec![EntityState {
                id: 1,
                kind: EntityKind::Ship,
                pos: [1.0, 2.0, 3.0],
                rot: [0.0, 0.0, 0.0, 1.0],
                vel: [10.0, 0.0, 0.0],
                hp_ratio: Some(0.75),
                display_name: Some("tester".into()),
                payload: None,
            }],
        });
        let bytes = bincode::serialize(&original).unwrap();
        let decoded: ServerMsg = bincode::deserialize(&bytes).unwrap();
        assert_eq!(original, decoded);
    }

    #[test]
    fn snapshot_with_npc_payload_roundtrips() {
        let original = ServerMsg::Snapshot(SnapshotData {
            tick: 200,
            server_time_ms: 10_000,
            entities: vec![EntityState {
                id: 7,
                kind: EntityKind::Npc,
                pos: [0.0, 0.0, 0.0],
                rot: [0.0, 0.0, 0.0, 1.0],
                vel: [5.0, 0.0, 0.0],
                hp_ratio: Some(1.0),
                display_name: Some("pirate_01".into()),
                payload: Some(EntityPayload::Npc(NpcPayload {
                    archetype: 1,
                    ai_state: 2, // Chase
                    radius: 5.0,
                    target_id: Some(42),
                })),
            }],
        });
        let bytes = bincode::serialize(&original).unwrap();
        let decoded: ServerMsg = bincode::deserialize(&bytes).unwrap();
        assert_eq!(original, decoded);
    }

    #[test]
    fn snapshot_with_asteroid_payload_roundtrips() {
        let original = ServerMsg::Snapshot(SnapshotData {
            tick: 300,
            server_time_ms: 15_000,
            entities: vec![EntityState {
                id: 99,
                kind: EntityKind::Asteroid,
                pos: [100.0, 200.0, 300.0],
                rot: [0.0, 0.0, 0.0, 1.0],
                vel: [0.0, 0.0, 0.0],
                hp_ratio: None,
                display_name: None,
                payload: Some(EntityPayload::Asteroid(AsteroidPayload {
                    kind: 1, // Iron
                    radius: 25.0,
                    resource_units: 50,
                })),
            }],
        });
        let bytes = bincode::serialize(&original).unwrap();
        let decoded: ServerMsg = bincode::deserialize(&bytes).unwrap();
        assert_eq!(original, decoded);
    }

    #[test]
    fn snapshot_with_anomaly_payload_roundtrips() {
        let original = ServerMsg::Snapshot(SnapshotData {
            tick: 400,
            server_time_ms: 20_000,
            entities: vec![EntityState {
                id: 12,
                kind: EntityKind::Anomaly,
                pos: [500.0, 0.0, 0.0],
                rot: [0.0, 0.0, 0.0, 1.0],
                vel: [0.0, 0.0, 0.0],
                hp_ratio: None,
                display_name: None,
                payload: Some(EntityPayload::Anomaly(AnomalyPayload {
                    kind: 0, // Warp
                    radius: 80.0,
                    intensity: 1.0,
                    target_warp_id: Some(13),
                })),
            }],
        });
        let bytes = bincode::serialize(&original).unwrap();
        let decoded: ServerMsg = bincode::deserialize(&bytes).unwrap();
        assert_eq!(original, decoded);
    }

    #[test]
    fn snapshot_with_wreck_payload_roundtrips() {
        let original = ServerMsg::Snapshot(SnapshotData {
            tick: 500,
            server_time_ms: 25_000,
            entities: vec![EntityState {
                id: 33,
                kind: EntityKind::Wreck,
                pos: [1.0, 1.0, 1.0],
                rot: [0.0, 0.0, 0.0, 1.0],
                vel: [0.0, 0.0, 0.0],
                hp_ratio: None,
                display_name: Some("hauler_light".into()),
                payload: Some(EntityPayload::Wreck(WreckPayload {
                    ship_template: "hauler_light".into(),
                    radius: 12.0,
                    ttl_remaining: 4500,
                    loot_count: 3,
                })),
            }],
        });
        let bytes = bincode::serialize(&original).unwrap();
        let decoded: ServerMsg = bincode::deserialize(&bytes).unwrap();
        assert_eq!(original, decoded);
    }

    #[test]
    fn protocol_version_is_v11() {
        // v2: payloads por tipo. v3: estáticos por AOI. v4: pitch/roll.
        // v5: loadout no Join + corpos celestes. v6: tiro carregado +
        // vórtices de dobra. v7: aparência do projétil (arma + carga).
        // v8: skills no Join. v9: consumíveis no Join e no Input.
        // v10: torpedos teleguiados e iscas de dispersão.
        // v11: campo de provas.
        assert_eq!(PROTOCOL_VERSION, 11);
    }

    #[test]
    fn projectile_payload_roundtrips() {
        let original = ServerMsg::Snapshot(SnapshotData {
            tick: 1,
            server_time_ms: 1,
            entities: vec![EntityState {
                id: 5,
                kind: EntityKind::Projectile,
                pos: [1.0, 2.0, 3.0],
                rot: [0.0, 0.0, 0.0, 1.0],
                vel: [0.0, 0.0, 200.0],
                hp_ratio: None,
                display_name: None,
                payload: Some(EntityPayload::Projectile(ProjectilePayload {
                    visual: 3,
                    charge: 0.85,
                    radius: 2.4,
                })),
            }],
        });
        let bytes = bincode::serialize(&original).unwrap();
        let decoded: ServerMsg = bincode::deserialize(&bytes).unwrap();
        assert_eq!(original, decoded);
    }

    #[test]
    fn world_chunk_roundtrips() {
        let original = ServerMsg::WorldChunk(WorldChunkData {
            tick: 42,
            entities: vec![EntityState {
                id: 7,
                kind: EntityKind::Asteroid,
                pos: [1.0, 2.0, 3.0],
                rot: [0.0, 0.0, 0.0, 1.0],
                vel: [0.0, 0.0, 0.0],
                hp_ratio: None,
                display_name: None,
                payload: Some(EntityPayload::Asteroid(AsteroidPayload {
                    kind: 1,
                    radius: 4.0,
                    resource_units: 100,
                })),
            }],
            expired: vec![9, 10],
        });
        let bytes = bincode::serialize(&original).unwrap();
        let decoded: ServerMsg = bincode::deserialize(&bytes).unwrap();
        assert_eq!(original, decoded);
    }

    #[test]
    fn aoi_hysteresis_is_positive() {
        // A margem existe para impedir que uma entidade na borda entre e
        // saia da visão a cada tick, gerando retransmissão infinita.
        const { assert!(AOI_HYSTERESIS > 0.0) };
        const { assert!(AOI_RADIUS > AOI_HYSTERESIS) };
    }
}

/// Fixtures douradas para o cliente TypeScript.
///
/// O decodificador TS é escrito à mão e já saiu de sincronia uma vez de
/// um jeito que os testes não pegaram: a fixture do teste TS codificava
/// `Option<EntityPayload>` com a MESMA suposição errada do decodificador
/// (um byte só, em vez de byte do Option + discriminante u32), então os
/// dois concordavam e erravam juntos. Em produção o snapshot inteiro
/// desalinhava e o erro que aparecia era `EntityKind desconhecido:
/// 2147483648`.
///
/// Aqui os bytes saem do bincode de verdade e vão para um arquivo que o
/// teste TS lê. Se um dos lados mudar sozinho, o teste quebra.
#[cfg(test)]
mod golden {
    use super::*;
    use std::io::Write;

    #[test]
    fn escreve_fixture_para_o_cliente() {
        let msg = ServerMsg::Snapshot(SnapshotData {
            tick: 4242,
            server_time_ms: 777,
            entities: vec![
                EntityState {
                    id: 1,
                    kind: EntityKind::Ship,
                    pos: [1.0, 2.0, 3.0],
                    rot: [0.0, 0.0, 0.0, 1.0],
                    vel: [4.0, 5.0, 6.0],
                    hp_ratio: Some(0.5),
                    display_name: Some("alice".into()),
                    payload: None,
                },
                EntityState {
                    id: 2,
                    kind: EntityKind::Vortex,
                    pos: [10.0, 0.0, -10.0],
                    rot: [0.0, 0.0, 0.0, 1.0],
                    vel: [0.0, 0.0, 0.0],
                    hp_ratio: None,
                    display_name: None,
                    payload: Some(EntityPayload::Vortex(VortexPayload {
                        dir: [0.0, 0.0, 1.0],
                        radius: 26.0,
                        strength: 0.75,
                    })),
                },
                // Depois do vórtice de propósito: se o payload for lido
                // com o tamanho errado, é esta entidade que explode.
                EntityState {
                    id: 3,
                    kind: EntityKind::Projectile,
                    pos: [7.0, 8.0, 9.0],
                    rot: [0.0, 0.0, 0.0, 1.0],
                    vel: [0.0, 0.0, 100.0],
                    hp_ratio: None,
                    display_name: None,
                    // Tiro de Lança carregado quase ao máximo: é o
                    // caso que o cliente precisa saber desenhar
                    // diferente de um toque de laser.
                    payload: Some(EntityPayload::Projectile(ProjectilePayload {
                        visual: 3,
                        charge: 0.9,
                        radius: 2.9,
                    })),
                },
            ],
        });

        let bytes = bincode::serialize(&msg).unwrap();
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../apps/client/src/net/__fixtures__");
        std::fs::create_dir_all(dir).unwrap();
        let mut f = std::fs::File::create(format!("{dir}/snapshot_v6.bin")).unwrap();
        f.write_all(&bytes).unwrap();
    }
}

/// Fixture do catálogo de armas para o cliente.
///
/// O cliente mantém um espelho dos números das armas
/// (`apps/client/src/data/weapons.ts`) para desenhar a barra de carga e
/// dizer ao jogador quanto ele está ganhando ao segurar o gatilho. É uma
/// duplicação necessária — o cliente não fala Rust — e portanto uma
/// chance de divergir em silêncio: um rebalanceamento aqui deixaria a
/// interface mentindo sobre o dano, sem nenhum erro aparecer.
///
/// Esta fixture é a amarração. Se os números mudarem de um lado só, o
/// teste do cliente quebra.
#[cfg(test)]
mod weapon_fixture {
    use sim_core::ship::weapons::weapon_profile;
    use std::io::Write;

    #[test]
    fn escreve_catalogo_para_o_cliente() {
        let ids = ["railgun_s", "laser_burst", "plasma_m", "lance_singular"];
        let mut linhas: Vec<String> = Vec::new();
        for id in ids {
            let w = weapon_profile(id).expect("arma do catálogo");
            linhas.push(format!(
                "  \"{}\": {{ \"chargeTime\": {}, \"chargeDamageMult\": {}, \"visual\": {} }}",
                id,
                w.charge_time,
                w.charge_damage_mult,
                w.visual.to_index()
            ));
        }
        let json = format!("{{\n{}\n}}\n", linhas.join(",\n"));

        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../apps/client/src/net/__fixtures__");
        std::fs::create_dir_all(dir).unwrap();
        let mut f = std::fs::File::create(format!("{dir}/weapons.json")).unwrap();
        f.write_all(json.as_bytes()).unwrap();
    }
}

/// Fixture dos efeitos de skill para o cliente.
///
/// O hangar precisa ANTECIPAR o dano que o servidor vai calcular, senão
/// o painel mente: o jogador compra "+5% weapon damage" e o DPS exibido
/// não se mexe. Isso obriga a duplicar os números em TypeScript — e
/// portanto a amarrá-los, como já se faz com o catálogo de armas.
#[cfg(test)]
mod skill_fixture {
    use sim_core::ship::skills::combat_mods;
    use std::io::Write;

    #[test]
    fn escreve_efeitos_para_o_cliente() {
        let ids = [
            "combat_t1",
            "combat_t2",
            "combat_t3",
            "combat_t4",
            "combat_t5",
        ];
        let mut linhas: Vec<String> = Vec::new();
        for id in ids {
            let m = combat_mods(&[id.to_string()]);
            linhas.push(format!(
                "  \"{}\": {{ \"damageMult\": {}, \"fireRateMult\": {}, \"shieldPierce\": {}, \"chargeTimeMult\": {} }}",
                id, m.damage_mult, m.fire_rate_mult, m.shield_pierce, m.charge_time_mult
            ));
        }
        let json = format!("{{
{}
}}
", linhas.join(",
"));

        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../apps/client/src/net/__fixtures__");
        std::fs::create_dir_all(dir).unwrap();
        let mut f = std::fs::File::create(format!("{dir}/skills.json")).unwrap();
        f.write_all(json.as_bytes()).unwrap();
    }
}

/// Fixture da solução de mira para o cliente.
///
/// O retículo do cliente refaz esta conta em TypeScript, porque precisa
/// dela a cada quadro. Uma divergência não quebra nada — só faz a mira
/// apontar para o lugar errado, em silêncio, que é o pior modo de falha
/// possível para um recurso de pontaria.
#[cfg(test)]
mod aim_fixture {
    use sim_core::ship::aim::{solve, AimInput};
    use std::io::Write;

    #[test]
    fn escreve_casos_de_mira_para_o_cliente() {
        let casos: Vec<(&str, AimInput)> = vec![
            (
                "parado",
                AimInput {
                    shooter_pos: [0.0, 0.0, 0.0],
                    shooter_vel: [0.0, 0.0, 0.0],
                    target_pos: [0.0, 0.0, 200.0],
                    target_vel: [0.0, 0.0, 0.0],
                    projectile_speed: 200.0,
                    gravity: [0.0, 0.0, 0.0],
                    projectile_ttl: 4.0,
                },
            ),
            (
                "cruzando",
                AimInput {
                    shooter_pos: [0.0, 0.0, 0.0],
                    shooter_vel: [0.0, 0.0, 0.0],
                    target_pos: [0.0, 0.0, 400.0],
                    target_vel: [70.0, 0.0, 0.0],
                    projectile_speed: 200.0,
                    gravity: [0.0, 0.0, 0.0],
                    projectile_ttl: 4.0,
                },
            ),
            (
                "com_gravidade",
                AimInput {
                    shooter_pos: [0.0, 0.0, 0.0],
                    shooter_vel: [0.0, 0.0, 0.0],
                    target_pos: [0.0, 0.0, 300.0],
                    target_vel: [0.0, 0.0, 0.0],
                    projectile_speed: 180.0,
                    gravity: [0.0, -40.0, 0.0],
                    projectile_ttl: 4.0,
                },
            ),
            (
                "nave_em_movimento",
                AimInput {
                    shooter_pos: [10.0, 5.0, -20.0],
                    shooter_vel: [30.0, 0.0, 60.0],
                    target_pos: [120.0, 40.0, 500.0],
                    target_vel: [-25.0, 10.0, 15.0],
                    projectile_speed: 240.0,
                    gravity: [0.0, -18.0, 5.0],
                    projectile_ttl: 3.0,
                },
            ),
            (
                "fora_de_alcance",
                AimInput {
                    shooter_pos: [0.0, 0.0, 0.0],
                    shooter_vel: [0.0, 0.0, 0.0],
                    target_pos: [0.0, 0.0, 5000.0],
                    target_vel: [0.0, 0.0, 0.0],
                    projectile_speed: 200.0,
                    gravity: [0.0, 0.0, 0.0],
                    projectile_ttl: 4.0,
                },
            ),
        ];

        let mut linhas: Vec<String> = Vec::new();
        for (nome, i) in &casos {
            let s = solve(i);
            linhas.push(format!(
                "  \"{}\": {{\n    \"input\": {{ \"shooterPos\": [{},{},{}], \"shooterVel\": [{},{},{}], \"targetPos\": [{},{},{}], \"targetVel\": [{},{},{}], \"projectileSpeed\": {}, \"gravity\": [{},{},{}], \"projectileTtl\": {} }},\n    \"leadPoint\": [{},{},{}],\n    \"timeOfFlight\": {},\n    \"difficulty\": {},\n    \"reachable\": {}\n  }}",
                nome,
                i.shooter_pos[0], i.shooter_pos[1], i.shooter_pos[2],
                i.shooter_vel[0], i.shooter_vel[1], i.shooter_vel[2],
                i.target_pos[0], i.target_pos[1], i.target_pos[2],
                i.target_vel[0], i.target_vel[1], i.target_vel[2],
                i.projectile_speed,
                i.gravity[0], i.gravity[1], i.gravity[2],
                i.projectile_ttl,
                s.lead_point[0], s.lead_point[1], s.lead_point[2],
                s.time_of_flight, s.difficulty, s.reachable
            ));
        }
        let json = format!("{{\n{}\n}}\n", linhas.join(",\n"));

        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../../apps/client/src/net/__fixtures__");
        std::fs::create_dir_all(dir).unwrap();
        let mut f = std::fs::File::create(format!("{dir}/aim.json")).unwrap();
        f.write_all(json.as_bytes()).unwrap();
    }
}
