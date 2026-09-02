//! Estado compartilhado do servidor: World + registry de clients.
//!
//! # Escala multiplayer
//!
//! Três decisões aqui definem quantos jogadores cabem num shard:
//!
//! 1. **Serializar uma vez, compartilhar bytes.** O broadcast antigo
//!    clonava o `ServerMsg` inteiro por cliente e serializava de novo em
//!    cada envio — com N clientes isso era N clones de um `Vec` de
//!    entidades (com `String` dentro) e N passagens de bincode, 20x por
//!    segundo. Agora codificamos uma vez para `Arc<Vec<u8>>` e cada
//!    cliente recebe só um ponteiro clonado.
//!
//! 2. **Canais limitados.** Os canais eram `unbounded`: um cliente lento
//!    acumulava snapshots até estourar a memória do processo. Agora são
//!    bounded; quando enchem, descartamos o snapshot daquele cliente
//!    (é estado, o próximo já corrige) e derrubamos quem não drena.
//!
//! 3. **Fila de input em vez de lock global por mensagem.** Cada `Input`
//!    pegava `world.write()`, disputando com o loop de simulação 30·N
//!    vezes por segundo. Agora o handler só empurra numa fila e o tick
//!    drena tudo sob o único write lock que já tomava.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use tokio::sync::{mpsc, RwLock};
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, warn};

use crate::net::protocol::{
    ServerMsg, WorldChunkData, AOI_HYSTERESIS, AOI_RADIUS, SNAPSHOT_EVERY_N_TICKS, TICK_RATE_HZ,
};
use crate::world::{EntityId, Position, World};

/// Frame já serializado, compartilhado entre clientes sem cópia.
pub type Frame = Arc<Vec<u8>>;

/// Profundidade da fila de saída por cliente.
///
/// A 20Hz, 32 frames são ~1,6s de folga. Além disso o cliente está
/// atrasado demais para que snapshots velhos ainda tenham valor.
const CLIENT_QUEUE_DEPTH: usize = 32;

/// Descartes consecutivos tolerados antes de considerar o cliente morto.
const MAX_CONSECUTIVE_DROPS: u32 = 60;

/// Profundidade da fila global de input. Inputs são pequenos e drenados
/// todo tick; a fila só existe para absorver rajadas.
const INPUT_QUEUE_DEPTH: usize = 4_096;

/// Input recebido de um cliente, à espera do próximo tick.
#[derive(Debug, Clone)]
pub enum PlayerCommand {
    Join {
        player_id: u32,
        name: String,
        /// `templateId`s equipados, em ordem de slot.
        loadout: Vec<String>,
        /// Nós da árvore de skills desbloqueados.
        skills: Vec<String>,
        /// Consumíveis levados para a arena.
        consumables: Vec<sim_core::ship::consumables::ConsumableSlot>,
    },
    Input {
        player_id: u32,
        steer: f32,
        pitch: f32,
        roll: f32,
        thrust: f32,
        fire: bool,
        /// Segundos de gatilho segurado (tiro carregado).
        fire_charge: f32,
        skill: Option<sim_core::skills::ActiveSkill>,
        /// Slot de consumível pedido neste pacote.
        use_consumable: Option<u8>,
    },
    Leave {
        player_id: u32,
    },
}

/// Handle para um client conectado.
pub struct ClientHandle {
    pub tx: mpsc::Sender<Frame>,
    /// Entidades estáticas que este cliente já recebeu. Evita reenviar
    /// asteroides parados a cada tick.
    pub known_static: HashSet<EntityId>,
    /// Frames descartados em sequência por fila cheia.
    pub consecutive_drops: u32,
}

impl ClientHandle {
    pub fn new(tx: mpsc::Sender<Frame>) -> Self {
        Self {
            tx,
            known_static: HashSet::new(),
            consecutive_drops: 0,
        }
    }

    /// Envia um frame sem bloquear.
    ///
    /// Retorna `false` quando o cliente deve ser removido — canal fechado
    /// ou atrasado além do tolerável. Um `Err(Full)` isolado não é fatal:
    /// snapshot é estado, não evento, e o próximo já traz a verdade.
    fn try_send(&mut self, frame: &Frame) -> bool {
        match self.tx.try_send(Arc::clone(frame)) {
            Ok(()) => {
                self.consecutive_drops = 0;
                true
            }
            Err(mpsc::error::TrySendError::Full(_)) => {
                self.consecutive_drops += 1;
                self.consecutive_drops < MAX_CONSECUTIVE_DROPS
            }
            Err(mpsc::error::TrySendError::Closed(_)) => false,
        }
    }
}

/// Estado global do servidor. Compartilhado entre tasks.
#[derive(Clone)]
pub struct ServerState {
    pub world: Arc<RwLock<World>>,
    pub clients: Arc<RwLock<HashMap<u32, ClientHandle>>>,
    pub next_player_id: Arc<std::sync::atomic::AtomicU32>,
    /// Fila de comandos drenada pelo loop de simulação.
    commands: mpsc::Sender<PlayerCommand>,
    command_rx: Arc<RwLock<Option<mpsc::Receiver<PlayerCommand>>>>,
}

// `with_world_seed`, `spawn_player_ship` e `set_player_input` são a API
// usada pelos testes e pela lib; o binário só usa `new` + a fila.
#[allow(dead_code)]
impl ServerState {
    pub fn new() -> Self {
        Self::from_world(World::new())
    }

    /// Cria um ServerState com seed de mundo customizada.
    pub fn with_world_seed(seed: u32) -> Self {
        let mut world = World::new();
        world.world_seed = seed;
        Self::from_world(world)
    }

    fn from_world(world: World) -> Self {
        let (tx, rx) = mpsc::channel(INPUT_QUEUE_DEPTH);
        Self {
            world: Arc::new(RwLock::new(world)),
            clients: Arc::new(RwLock::new(HashMap::new())),
            next_player_id: Arc::new(std::sync::atomic::AtomicU32::new(0)),
            commands: tx,
            command_rx: Arc::new(RwLock::new(Some(rx))),
        }
    }

    /// Enfileira um comando para o próximo tick. Não toma lock do mundo.
    pub fn enqueue(&self, cmd: PlayerCommand) {
        if self.commands.try_send(cmd).is_err() {
            // Fila cheia significa que a simulação está muito atrás; o
            // input mais novo chega no tick seguinte de qualquer forma.
            debug!("fila de comandos cheia, descartando input");
        }
    }

    /// Registra um cliente e devolve o receptor de frames.
    pub async fn register_client(&self, player_id: u32) -> mpsc::Receiver<Frame> {
        let (tx, rx) = mpsc::channel(CLIENT_QUEUE_DEPTH);
        self.clients
            .write()
            .await
            .insert(player_id, ClientHandle::new(tx));
        rx
    }

    pub async fn unregister_client(&self, player_id: u32) {
        self.clients.write().await.remove(&player_id);
        self.enqueue(PlayerCommand::Leave { player_id });
    }

    /// Adiciona uma nave para o player e devolve o entity_id.
    pub async fn spawn_player_ship(&self, player_id: u32, name: String) -> u32 {
        let mut world = self.world.write().await;
        world.spawn_player_ship(player_id, name)
    }

    /// Envia mensagem para um player. Falha silenciosa se desconectou.
    pub async fn send_to(&self, player_id: u32, msg: ServerMsg) {
        let frame = encode_frame(&msg);
        let mut clients = self.clients.write().await;
        if let Some(h) = clients.get_mut(&player_id) {
            if !h.try_send(&frame) {
                clients.remove(&player_id);
            }
        }
    }

    /// Broadcast para todos os clients.
    ///
    /// Serializa UMA vez; cada cliente recebe um `Arc` clonado.
    pub async fn broadcast(&self, msg: ServerMsg) {
        let frame = encode_frame(&msg);
        self.broadcast_frame(&frame).await;
    }

    async fn broadcast_frame(&self, frame: &Frame) {
        let mut clients = self.clients.write().await;
        let mut dead: Vec<u32> = Vec::new();
        for (id, h) in clients.iter_mut() {
            if !h.try_send(frame) {
                dead.push(*id);
            }
        }
        for id in dead {
            warn!(player_id = id, "cliente removido: fila saturada ou fechada");
            clients.remove(&id);
        }
    }

    pub fn alloc_player_id(&self) -> u32 {
        self.next_player_id
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
    }

    /// Corpos celestes do setor, para enviar no handshake.
    pub async fn sector_bodies(&self) -> Vec<sim_core::worldgen::celestial::CelestialBody> {
        self.world.read().await.bodies.clone()
    }

    /// Lê o world_seed atual (para enviar no Welcome).
    pub async fn world_seed(&self) -> u32 {
        let world = self.world.read().await;
        world.world_seed
    }

    /// Aplica input do player diretamente (usado em testes; o caminho de
    /// rede usa `enqueue` + drenagem no tick).
    #[allow(clippy::too_many_arguments)]
    pub async fn set_player_input(
        &self,
        player_id: u32,
        steer: f32,
        pitch: f32,
        roll: f32,
        thrust: f32,
        fire: bool,
        fire_charge: f32,
        skill: Option<sim_core::skills::ActiveSkill>,
        use_consumable: Option<u8>,
    ) {
        let mut world = self.world.write().await;
        world.set_input(
            player_id,
            steer,
            pitch,
            roll,
            thrust,
            fire,
            fire_charge,
            skill,
            use_consumable,
        );
    }
}

impl Default for ServerState {
    fn default() -> Self {
        Self::new()
    }
}

/// Loop de simulação autoritativo: tick físico a `TICK_RATE_HZ`,
/// broadcast de snapshot a `SNAPSHOT_RATE_HZ`.
pub async fn run_simulation_loop(state: ServerState) {
    use std::time::Duration;
    // Derivado da constante do protocolo, não hardcoded: o cliente
    // recebe `SNAPSHOT_RATE_HZ` no Welcome e precisa bater com o que
    // realmente sai daqui.
    const TICK_DT: f32 = 1.0 / TICK_RATE_HZ as f32;

    let mut command_rx = match state.command_rx.write().await.take() {
        Some(rx) => rx,
        None => {
            warn!("run_simulation_loop chamado duas vezes; abortando o segundo");
            return;
        }
    };

    let mut ticker = tokio::time::interval(Duration::from_secs_f32(TICK_DT));
    // Se um tick atrasar, não tentamos "recuperar" disparando vários de
    // uma vez — isso só piora a fila em servidor sobrecarregado.
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    let mut tick_count: u64 = 0;
    let mut command_buf: Vec<PlayerCommand> = Vec::with_capacity(256);

    loop {
        ticker.tick().await;

        // --- 1. Drena a fila de comandos sem bloquear ---
        command_buf.clear();
        while let Ok(cmd) = command_rx.try_recv() {
            command_buf.push(cmd);
            if command_buf.len() >= INPUT_QUEUE_DEPTH {
                break;
            }
        }

        // --- 2. Um único write lock por tick: aplica, simula, coleta ---
        let (destroyed, events, party_of) = {
            let mut world = state.world.write().await;

            for cmd in command_buf.drain(..) {
                match cmd {
                    PlayerCommand::Join { player_id, name, loadout, skills, consumables } => {
                        world.spawn_player_ship(player_id, name);
                        // O loadout é aplicado logo após o spawn: os
                        // números vêm do catálogo do servidor.
                        world.apply_loadout_and_skills(player_id, &loadout, &skills);
                        world.apply_consumables(player_id, &consumables);
                    }
                    PlayerCommand::Input {
                        player_id,
                        steer,
                        pitch,
                        roll,
                        thrust,
                        fire,
                        fire_charge,
                        skill,
                        use_consumable,
                    } => {
                        world.set_input(
                            player_id,
                            steer,
                            pitch,
                            roll,
                            thrust,
                            fire,
                            fire_charge,
                            skill,
                            use_consumable,
                        );
                    }
                    PlayerCommand::Leave { player_id } => {
                        world.despawn_player(player_id);
                    }
                }
            }

            world.step(TICK_DT);

            // A tabela de parties é copiada aqui, dentro do lock que já
            // temos. Antes, o laço de destruídos abria um `world.read()`
            // por entidade morta.
            let party_of = world.parties.clone();
            (world.take_destroyed(), world.take_events(), party_of)
        };

        // --- 3. Broadcast fora do lock ---
        for event in events {
            state.broadcast(event).await;
        }

        for (entity_id, killer_opt) in destroyed {
            state
                .broadcast(ServerMsg::EntityDestroyed { entity_id })
                .await;

            let Some(killer_id) = killer_opt else { continue };

            // XP compartilhado com a party (Task 6.2).
            // TODO: valor por tipo de alvo, vindo do banco.
            let xp_amount = 50;
            let receivers: Vec<u32> = match party_of.get(&killer_id) {
                Some(party_id) => party_of
                    .iter()
                    .filter(|(_, p)| *p == party_id)
                    .map(|(pid, _)| *pid)
                    .collect(),
                None => vec![killer_id],
            };
            for p in receivers {
                state
                    .send_to(
                        p,
                        ServerMsg::XpGained {
                            amount: xp_amount,
                            reason: "Enemy destroyed".to_string(),
                        },
                    )
                    .await;
            }
        }

        tick_count += 1;
        if tick_count.is_multiple_of(SNAPSHOT_EVERY_N_TICKS) {
            broadcast_snapshots(&state).await;
        }
    }
}

/// Envia a cada cliente só o que está no raio de interesse dele.
///
/// Dinâmicas vão todo tick; estáticas vão uma vez, quando entram no raio.
async fn broadcast_snapshots(state: &ServerState) {
    let world = state.world.read().await;
    let tick = world.tick;
    let server_time_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let mut clients = state.clients.write().await;
    let mut dead: Vec<u32> = Vec::new();

    for (player_id, handle) in clients.iter_mut() {
        // Sem nave (morto ou ainda no Join): recebe o snapshot centrado
        // na origem, para ver a arena enquanto espera respawn.
        let center = world.player_position(*player_id).unwrap_or_default();

        // --- Dinâmicas ---
        let entities = crate::world::build_dynamic_snapshot(&world, center, AOI_RADIUS);
        let snap = crate::net::protocol::SnapshotData {
            tick,
            server_time_ms,
            entities,
        };
        let frame = encode_frame(&ServerMsg::Snapshot(snap));
        if !handle.try_send(&frame) {
            dead.push(*player_id);
            continue;
        }

        // --- Estáticas: só o diff contra o que o cliente já tem ---
        let near = crate::world::static_entities_near(&world, center, AOI_RADIUS);
        let mut fresh = Vec::new();
        let mut visible: HashSet<EntityId> = HashSet::with_capacity(near.len());
        for e in near {
            visible.insert(e.id);
            if !handle.known_static.contains(&e.id) {
                fresh.push(e);
            }
        }

        // Histerese na saída: só esquece o que passou bem do raio, para
        // uma entidade na borda não ficar entrando e saindo a cada tick.
        let drop_radius_sq = (AOI_RADIUS + AOI_HYSTERESIS) * (AOI_RADIUS + AOI_HYSTERESIS);
        let expired: Vec<EntityId> = handle
            .known_static
            .iter()
            .copied()
            .filter(|id| {
                if visible.contains(id) {
                    return false;
                }
                match static_position(&world, *id) {
                    // Sumiu do mundo (minerado/expirado): o cliente já
                    // recebe `EntityDestroyed`, não repetimos aqui.
                    None => true,
                    Some(p) => crate::world::dist_sq(p, center) > drop_radius_sq,
                }
            })
            .collect();

        if fresh.is_empty() && expired.is_empty() {
            continue;
        }

        for e in &fresh {
            handle.known_static.insert(e.id);
        }
        for id in &expired {
            handle.known_static.remove(id);
        }

        let chunk = ServerMsg::WorldChunk(WorldChunkData {
            tick,
            entities: fresh,
            expired,
        });
        if !handle.try_send(&encode_frame(&chunk)) {
            dead.push(*player_id);
        }
    }

    for id in dead {
        warn!(player_id = id, "cliente removido no broadcast de snapshot");
        clients.remove(&id);
    }
}

/// Posição de uma entidade estática, se ainda existir.
fn static_position(world: &World, id: EntityId) -> Option<Position> {
    world
        .asteroids
        .get(&id)
        .map(|(p, _)| *p)
        .or_else(|| world.anomalies.get(&id).map(|(p, _)| *p))
        .or_else(|| world.wrecks.get(&id).map(|(p, _)| *p))
}

/// Serializa uma mensagem em um frame compartilhável.
pub fn encode_frame(msg: &ServerMsg) -> Frame {
    Arc::new(bincode::serialize(msg).expect("ServerMsg is serializable"))
}

/// Helper para enviar um Message binário para um client.
pub fn encode_msg(msg: &ServerMsg) -> Message {
    Message::Binary(bincode::serialize(msg).expect("ServerMsg is serializable"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn set_player_input_updates_ship() {
        let state = ServerState::new();
        let _ship = state.spawn_player_ship(7, "alpha".into()).await;

        state
            .set_player_input(7, 0.5, 0.0, 0.0, 0.8, true, 0.0, Some(sim_core::skills::ActiveSkill::Dash), None)
            .await;

        let world = state.world.read().await;
        let (_p, _v, _r, ship) = world
            .ships
            .values()
            .find(|(_, _, _, s)| s.owner_player_id == 7)
            .expect("ship do player 7");
        assert!((ship.steer_input - 0.5).abs() < 1e-6);
        assert!((ship.thrust_input - 0.8).abs() < 1e-6);
        assert!(ship.pending_fire);
        assert_eq!(ship.skill_input, Some(sim_core::skills::ActiveSkill::Dash));
    }

    #[tokio::test]
    async fn set_player_input_clamps_values() {
        let state = ServerState::new();
        let _ = state.spawn_player_ship(1, "x".into()).await;
        state.set_player_input(1, 5.0, 0.0, 0.0, -1.0, false, 0.0, None, None).await;
        let world = state.world.read().await;
        let (_, _, _, ship) = world
            .ships
            .values()
            .find(|(_, _, _, s)| s.owner_player_id == 1)
            .unwrap();
        assert_eq!(ship.steer_input, 1.0);
        assert_eq!(ship.thrust_input, 0.0);
    }

    #[tokio::test]
    async fn input_drives_movement_in_simulation() {
        let state = ServerState::new();
        let _ = state.spawn_player_ship(42, "y".into()).await;
        state.set_player_input(42, 0.0, 0.0, 0.0, 1.0, false, 0.0, None, None).await;

        // Avança 30 ticks (1s a 30Hz).
        for _ in 0..30 {
            let mut world = state.world.write().await;
            world.step(1.0 / 30.0);
        }

        let world = state.world.read().await;
        let (p, _v, _r, _ship) = world
            .ships
            .values()
            .find(|(_, _, _, s)| s.owner_player_id == 42)
            .unwrap();
        assert!(p.z > 0.0, "esperado movimento +Z, got {p:?}");
    }

    #[tokio::test]
    async fn broadcast_drops_client_that_never_drains() {
        let state = ServerState::new();
        let _rx = state.register_client(1).await;
        // Enche a fila muito além da profundidade sem ler nada.
        for _ in 0..(CLIENT_QUEUE_DEPTH as u32 + MAX_CONSECUTIVE_DROPS + 5) {
            state.broadcast(ServerMsg::Pong { nonce: 1 }).await;
        }
        assert!(
            !state.clients.read().await.contains_key(&1),
            "cliente travado deveria ter sido removido em vez de acumular memória"
        );
    }

    #[tokio::test]
    async fn broadcast_keeps_client_that_drains() {
        let state = ServerState::new();
        let mut rx = state.register_client(2).await;
        for _ in 0..200 {
            state.broadcast(ServerMsg::Pong { nonce: 7 }).await;
            let _ = rx.try_recv();
        }
        assert!(state.clients.read().await.contains_key(&2));
    }

    #[tokio::test]
    async fn enqueued_commands_apply_on_tick() {
        let state = ServerState::new();
        state.enqueue(PlayerCommand::Join {
            player_id: 3,
            name: "queued".into(),
            loadout: vec!["railgun_s".into()],
            skills: vec![],
            consumables: vec![],
        });

        // Simula um tick do loop: drena e aplica.
        let mut rx = state.command_rx.write().await.take().unwrap();
        let mut world = state.world.write().await;
        while let Ok(cmd) = rx.try_recv() {
            if let PlayerCommand::Join { player_id, name, .. } = cmd {
                world.spawn_player_ship(player_id, name);
            }
        }
        assert!(world.player_ships.contains_key(&3));
    }
}
