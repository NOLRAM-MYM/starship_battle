//! Estado de simulação autoritativo.
//!
//! Para a Fase 2 MVP usamos estruturas próprias (Vec<Ship>, Vec<Projectile>) em vez
//! de bevy_ecs puro. Quando passarmos a 100 players e schedules complexas (Fase 3+),
//! migramos para `bevy_ecs` Schedule — a interface `step()` permanece estável.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::net::protocol::{
    VFX_DECOY, VFX_EMP, VFX_EXPLOSION_LARGE, VFX_EXPLOSION_SHIP, VFX_IMPACT, VFX_MUZZLE,
};

use crate::net::protocol::{EntityKind, EntityPayload, ProjectilePayload, TorpedoPayload};
use sim_core::skills::{ActiveSkill, SkillManager};

/// ID autoritativo de uma entidade.
pub type EntityId = u32;

/// Componentes físicos.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct Position {
    pub x: f32, pub y: f32, pub z: f32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct Velocity {
    pub x: f32, pub y: f32, pub z: f32,
}

/// Orientação em quaternion (x,y,z,w).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rotation {
    pub x: f32, pub y: f32, pub z: f32, pub w: f32,
}

impl Default for Rotation {
    fn default() -> Self { Self { x: 0.0, y: 0.0, z: 0.0, w: 1.0 } }
}

/// Estado de uma nave.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Ship {
    pub owner_player_id: u32,
    pub name: String,
    pub thrust_input: f32,  // 0..=1
    pub steer_input: f32,   // -1..=1 (yaw)
    pub pitch_input: f32,   // -1..=1 (nariz cima/baixo)
    pub roll_input: f32,    // -1..=1 (inclinação longitudinal)
    pub hull_hp: f32,
    pub hull_max: f32,
    pub shield_hp: f32,
    pub shield_max: f32,
    /// Comportamento de alvo de treino, se esta nave for um.
    ///
    /// `None` para naves de jogador. Um alvo de treino é uma nave comum
    /// com um roteiro: assim ele passa pelos mesmos caminhos de dano,
    /// escudo e travamento que um adversário humano.
    pub training: Option<sim_core::ship::training::TrainingDummy>,
    /// Lançador de torpedos equipado, se houver.
    pub torpedo: Option<sim_core::ship::torpedo::TorpedoProfile>,
    /// Espera até poder lançar outro torpedo.
    pub torpedo_cooldown: f32,
    /// Consumíveis levados para a arena, com as cargas restantes.
    pub belt: sim_core::ship::consumables::ConsumableBelt,
    /// Segundos restantes de paralisia por PEM.
    ///
    /// Enquanto > 0 a nave não atira nem acelera. É o efeito que faltava
    /// para a tecla 2 fazer alguma coisa — o PEM existia no enum e no
    /// HUD, mas nenhuma nave era afetada por ele.
    pub emp_remaining: f32,
    /// Fração do dano DESTA nave que ignora o escudo alvo (0..1).
    ///
    /// Vem da skill "Armor Piercing". Fica na nave atacante, não no
    /// projétil, porque é uma propriedade de quem atira.
    pub shield_pierce: f32,
    pub mass: f32,
    pub thrust_capacity: f32, // aceleração máxima (m/s²)
    pub turn_rate: f32,       // rad/s
    pub drag: f32,            // coeficiente de arrasto linear
    /// Disparos pendentes (consumidos pelo sistema de armas em Task 2.6).
    pub pending_fire: bool,
    /// Tempo desde o último disparo (cooldown em segundos).
    pub fire_cooldown: f32,
    /// Raio de colisão (esfera).
    pub radius: f32,
    /// Perfil da arma primária, resolvido do loadout no `Join`.
    pub weapon: sim_core::ship::weapons::WeaponProfile,
    /// Segundos que o gatilho ficou segurado no disparo pendente.
    pub pending_charge: f32,
    /// Perfil de dobra, resolvido do loadout.
    pub warp: sim_core::ship::warp::WarpProfile,
    /// Aproveitamento extra de vórtices ALHEIOS (fração).
    pub vortex_gain: f32,
    /// Segundos restantes do salto de dobra. > 0 = em dobra.
    pub warp_remaining: f32,
    /// Conta-gotas para soltar vórtices em intervalos regulares.
    pub vortex_timer: f32,
    /// Regeneração de escudo por segundo.
    pub shield_regen: f32,
    /// Gerenciador de habilidades ativas.
    pub skills: SkillManager,
    /// Se o jogador solicitou ativação de uma skill neste frame.
    pub skill_input: Option<ActiveSkill>,
    /// Slot de consumível que o jogador pediu para usar neste tick.
    pub consumable_input: Option<u8>,
}

impl Default for Ship {
    fn default() -> Self {
        Self {
            owner_player_id: 0,
            name: String::new(),
            thrust_input: 0.0,
            steer_input: 0.0,
            pitch_input: 0.0,
            roll_input: 0.0,
            hull_hp: 100.0,
            hull_max: 100.0,
            training: None,
            torpedo: None,
            torpedo_cooldown: 0.0,
            belt: Default::default(),
            emp_remaining: 0.0,
            shield_pierce: 0.0,
            shield_hp: 50.0,
            shield_max: 50.0,
            mass: 1000.0,
            thrust_capacity: 10.0,
            turn_rate: 1.0,
            drag: 0.1,
            pending_fire: false,
            fire_cooldown: 0.0,
            radius: 3.0,
            weapon: sim_core::ship::weapons::DEFAULT_WEAPON,
            pending_charge: 0.0,
            warp: sim_core::ship::warp::BASE_WARP,
            vortex_gain: 0.0,
            warp_remaining: 0.0,
            vortex_timer: 0.0,
            shield_regen: 0.0,
            skills: SkillManager::new(),
            skill_input: None,
            consumable_input: None,
        }
    }
}

/// Estado de um projétil.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Projectile {
    pub owner_player_id: u32,
    /// Entidade que disparou.
    ///
    /// O `owner_player_id` não basta: `0` é sentinela de "sem dono" e
    /// dois NPCs (ou uma nave de teste) o compartilham, então a checagem
    /// por jogador deixava o projétil acertar a própria nave que atirou.
    pub owner_entity: EntityId,
    pub damage: f32,
    pub ttl_remaining: f32, // segundos
    pub radius: f32,
    /// Velocidade do projétil (m/s) — referência para clients.
    pub speed: f32,
    /// Raio de dano em área no impacto. 0 = só dano direto.
    pub splash_radius: f32,
    /// Família visual da arma que disparou (`WeaponVisual::to_index`).
    ///
    /// Só aparência: o cliente usa para desenhar um dardo de plasma
    /// diferente de um traçante cinético. O dano continua vindo daqui.
    pub visual: u8,
    /// 0..1 — carga aproveitada no disparo, para o cliente dimensionar
    /// o projétil e o impacto.
    pub charge: f32,
}

/// Estado de um asteroide no servidor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Asteroid {
    pub kind: u8,
    pub radius: f32,
    pub resource_units: u32,
    pub hull_hp: f32,
}

/// Estado de uma anomalia.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Anomaly {
    pub kind: u8,
    pub radius: f32,
    pub intensity: f32,
    pub target_warp_id: Option<u32>,
}

/// Estado de um wreck.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Wreck {
    pub ship_template: String,
    pub radius: f32,
    pub ttl_remaining: u64,
    pub loot_count: u32,
}

/// Mundo de simulação.
#[derive(Debug, Default)]
pub struct World {
    pub tick: u64,
    pub elapsed: f32,
    /// Seed do setor atual (para paridade servidor/cliente).
    pub world_seed: u32,
    pub ships: HashMap<EntityId, (Position, Velocity, Rotation, Ship)>,
    pub projectiles: HashMap<EntityId, (Position, Velocity, Projectile)>,
    /// Torpedos teleguiados em voo.
    ///
    /// Coleção separada dos projéteis porque eles têm ESTADO: trava,
    /// combustível e casco próprio. Misturá-los faria todo laço de
    /// projétil carregar campos que só um deles usa.
    pub torpedoes: HashMap<EntityId, (Position, sim_core::ship::torpedo::Torpedo)>,
    /// Iscas de dispersão ativas: (posição, segundos restantes, dono).
    ///
    /// São o que quebra a trava sem gastar a dobra.
    pub decoys: Vec<(Position, f32, u32)>,
    /// NPCs (entity_id → state). Posição/velocidade/rotação são geridas pelo módulo `npc`.
    pub npcs: HashMap<EntityId, crate::npc::Npc>,
    pub npc_positions: HashMap<EntityId, (Position, Velocity)>,
    /// Vórtices de dobra ativos.
    ///
    /// Ficam num `Vec` e não num `HashMap` porque só são varridos
    /// linearmente (poucos, e todos testados contra cada nave).
    pub vortices: Vec<(EntityId, sim_core::ship::warp::Vortex)>,
    /// Vortices criados durante o passo, materializados no fim dele.
    /// Cria-los durante a iteracao das naves emprestaria `self` duas vezes.
    pending_vortices: Vec<sim_core::ship::warp::Vortex>,
    /// Corpos celestes do setor (estrela, planetas, luas).
    ///
    /// Ficam FORA do `HashMap` de entidades porque não nascem nem morrem:
    /// são o cenário fixo que exerce gravidade e destrói quem colide.
    pub bodies: Vec<sim_core::worldgen::celestial::CelestialBody>,
    /// Asteroides, anomalias e wrecks persistidos.
    pub asteroids: HashMap<EntityId, (Position, Asteroid)>,
    pub anomalies: HashMap<EntityId, (Position, Anomaly)>,
    pub wrecks: HashMap<EntityId, (Position, Wreck)>,
    /// Mapeamento de player_id -> party_id
    pub parties: HashMap<u32, u32>,
    /// Índice player_id -> entity_id da sua nave.
    ///
    /// Sem ele `set_input` varria TODAS as naves para achar a do jogador:
    /// com N jogadores mandando input a 30Hz isso é O(30·N²) buscas por
    /// segundo, e era o pior custo por mensagem do servidor.
    pub player_ships: HashMap<u32, EntityId>,
    next_id: EntityId,
    destroyed: Vec<(EntityId, Option<u32>)>,
    events: Vec<crate::net::protocol::ServerMsg>,
    last_dt: f32,
}

impl Default for Projectile {
    fn default() -> Self {
        Self {
            owner_player_id: 0,
            owner_entity: 0,
            damage: 10.0,
            ttl_remaining: 3.0,
            radius: 0.5,
            splash_radius: 0.0,
            // Velocidade baixa o suficiente para não causar tunneling em 30Hz
            // (100m/s * 1/30s = 3.33m por tick, < soma dos raios 3.5m).
            speed: 100.0,
            visual: 0,
            charge: 0.0,
        }
    }
}

// Vários métodos abaixo são usados pela lib e pelos testes de integração,
// mas não pelo binário — que compila os módulos numa árvore própria.
#[allow(dead_code)]
impl World {
    pub fn new() -> Self {
        let mut w = Self {
            next_id: 1, // 0 é reservado (invalid)
            ..Default::default()
        };
        w.rebuild_system();
        w
    }

    /// (Re)gera os corpos celestes a partir da `world_seed` atual.
    ///
    /// Chamado no construtor e sempre que a seed muda, para servidor e
    /// cliente nunca discordarem sobre onde está cada planeta.
    pub fn rebuild_system(&mut self) {
        self.bodies = sim_core::worldgen::celestial::generate_system(self.world_seed);
    }

    pub fn alloc_id(&mut self) -> EntityId {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    pub fn set_party(&mut self, player_id: u32, party_id: u32) {
        self.parties.insert(player_id, party_id);
    }

    pub fn remove_party(&mut self, player_id: u32) {
        self.parties.remove(&player_id);
    }

    /// Spawna uma nave de player com defaults.
    /// Aplica um loadout (ids de componente) à nave do jogador.
    ///
    /// Os números vêm do catálogo do servidor; o cliente só escolhe ids.
    pub fn apply_loadout(&mut self, player_id: u32, template_ids: &[String]) {
        self.apply_loadout_and_skills(player_id, template_ids, &[]);
    }

    /// Equipa o cinto de consumíveis da nave do jogador.
    ///
    /// Separado do loadout porque as cargas vêm do INVENTÁRIO da conta,
    /// não dos slots do chassi: o jogador pode entrar com três kits e
    /// sair com zero, e isso não muda a nave que ele montou.
    pub fn apply_consumables(
        &mut self,
        player_id: u32,
        slots: &[sim_core::ship::consumables::ConsumableSlot],
    ) {
        let Some(&id) = self.player_ships.get(&player_id) else { return };
        let Some((_, _, _, ship)) = self.ships.get_mut(&id) else { return };
        ship.belt = sim_core::ship::consumables::ConsumableBelt::from_loadout(slots);
    }

    /// Aplica equipamento e skills de uma vez.
    ///
    /// As duas coisas compõem o mesmo tiro — o equipamento define a arma
    /// e as skills a modificam —, então precisam ser resolvidas juntas:
    /// aplicar o loadout depois das skills apagaria os modificadores,
    /// que é justamente o tipo de bug silencioso que deixaria a árvore
    /// de skills sem efeito de novo.
    pub fn apply_loadout_and_skills(
        &mut self,
        player_id: u32,
        template_ids: &[String],
        skill_nodes: &[String],
    ) {
        let Some(&id) = self.player_ships.get(&player_id) else { return };
        let Some((_, _, _, ship)) = self.ships.get_mut(&id) else { return };
        let stats = sim_core::ship::weapons::resolve_loadout(template_ids);
        let (warp, ganho) = sim_core::ship::warp::resolve_warp(template_ids);

        // Lançador de torpedos: é uma peça à parte da arma primária,
        // com tecla própria. Uma nave pode ter as duas.
        ship.torpedo = template_ids
            .iter()
            .find_map(|id| sim_core::ship::torpedo::torpedo_profile(id));

        // Skills entram POR CIMA da arma resolvida.
        let mods = sim_core::ship::skills::combat_mods(skill_nodes);
        ship.shield_pierce = mods.shield_pierce;

        ship.warp = warp;
        ship.vortex_gain = ganho;
        ship.weapon = sim_core::ship::skills::apply_to_weapon(&stats.weapon, &mods);
        ship.shield_max = stats.shield_max;
        ship.shield_hp = stats.shield_max;
        ship.hull_max = stats.hull_max;
        ship.hull_hp = stats.hull_max;
        ship.mass = stats.mass;
        ship.shield_regen = stats.shield_regen;
        // Empuxo por tonelada: uma nave pesada com motor fraco acelera
        // devagar, que é o trade-off que o estaleiro anuncia.
        ship.thrust_capacity = if stats.mass > 0.0 {
            (stats.thrust / stats.mass) * 1000.0
        } else {
            0.0
        };
    }

    pub fn spawn_player_ship(&mut self, player_id: u32, name: String) -> EntityId {
        let id = self.alloc_id();

        let mut skills = SkillManager::new();
        // As três, não só o Dash. Antes o HUD mostrava os botões de PEM
        // e Reparo e as teclas 2 e 3 não faziam absolutamente nada,
        // porque as habilidades nunca eram destravadas.
        skills.unlock(ActiveSkill::Dash);
        skills.unlock(ActiveSkill::Emp);
        skills.unlock(ActiveSkill::Repair);

        let ship = Ship {
            owner_player_id: player_id,
            name,
            thrust_input: 0.0,
            steer_input: 0.0,
            pitch_input: 0.0,
            roll_input: 0.0,
            hull_hp: 100.0,
            hull_max: 100.0,
            training: None,
            torpedo: None,
            torpedo_cooldown: 0.0,
            belt: Default::default(),
            emp_remaining: 0.0,
            shield_pierce: 0.0,
            shield_hp: 50.0,
            shield_max: 50.0,
            mass: 1000.0,
            turn_rate: 2.0,
            thrust_capacity: 50.0,
            drag: PLAYER_SHIP_DRAG,
            pending_fire: false,
            fire_cooldown: 0.0,
            radius: 5.0,
            weapon: sim_core::ship::weapons::DEFAULT_WEAPON,
            pending_charge: 0.0,
            warp: sim_core::ship::warp::BASE_WARP,
            vortex_gain: 0.0,
            warp_remaining: 0.0,
            vortex_timer: 0.0,
            shield_regen: 0.0,
            skills,
            skill_input: None,
            consumable_input: None,
        };

        // Ponto de surgimento espalhado num anel.
        //
        // Todas as naves nasciam exatamente em (0,0,0), empilhadas: os
        // jogadores apareciam dentro uns dos outros e os disparos saíam
        // de dentro de outra nave. O anel é derivado do `id`, então é
        // determinístico e não precisa de RNG no caminho de spawn.
        const SPAWN_RING: f32 = 120.0;

        let ang = (id as f32) * 2.399_963_2; // ângulo áureo: distribui bem
        let pos = Position {
            x: ang.cos() * SPAWN_RING,
            y: ((id % 7) as f32 - 3.0) * 8.0,
            z: ang.sin() * SPAWN_RING,
        };

        self.ships.insert(
            id,
            (pos, Velocity::default(), Rotation::default(), ship),
        );
        self.player_ships.insert(player_id, id);
        id
    }

    /// Remove a nave do jogador (desconexão) e limpa os índices.
    pub fn despawn_player(&mut self, player_id: u32) {
        if let Some(id) = self.player_ships.remove(&player_id) {
            self.ships.remove(&id);
            self.destroyed.push((id, None));
        }
        self.parties.remove(&player_id);
    }

    /// Posição da nave do jogador, se ele estiver vivo no mundo.
    pub fn player_position(&self, player_id: u32) -> Option<Position> {
        let id = self.player_ships.get(&player_id)?;
        self.ships.get(id).map(|(p, _, _, _)| *p)
    }

    /// Spawna um NPC em uma posição.
    pub fn spawn_npc(
        &mut self,
        kind: crate::npc::NpcKind,
        pos: Position,
    ) -> EntityId {
        let id = self.alloc_id();
        let npc = crate::npc::Npc::new(kind, sim_core::ai::Vec3::new(pos.x, pos.y, pos.z));
        self.npcs.insert(id, npc);
        self.npc_positions.insert(id, (pos, Velocity::default()));
        id
    }

    /// Spawna um asteroide.
    pub fn spawn_asteroid(
        &mut self,
        pos: Position,
        kind: u8,
        radius: f32,
        resource_units: u32,
    ) -> EntityId {
        let id = self.alloc_id();
        self.asteroids.insert(
            id,
            (
                pos,
                Asteroid {
                    kind,
                    radius,
                    resource_units,
                    hull_hp: radius * 50.0,
                },
            ),
        );
        id
    }

    /// Spawna uma anomalia.
    pub fn spawn_anomaly(
        &mut self,
        pos: Position,
        kind: u8,
        radius: f32,
        intensity: f32,
        target_warp_id: Option<u32>,
    ) -> EntityId {
        let id = self.alloc_id();
        self.anomalies.insert(
            id,
            (pos, Anomaly { kind, radius, intensity, target_warp_id }),
        );
        id
    }

    /// Spawna um wreck.
    pub fn spawn_wreck(
        &mut self,
        pos: Position,
        ship_template: String,
        radius: f32,
        ttl_remaining: u64,
        loot_count: u32,
    ) -> EntityId {
        let id = self.alloc_id();
        self.wrecks.insert(
            id,
            (
                pos,
                Wreck {
                    ship_template,
                    radius,
                    ttl_remaining,
                    loot_count,
                },
            ),
        );
        id
    }

    /// Cooldown de disparo em segundos.
    const FIRE_COOLDOWN_SECS: f32 = 0.4;

    /// Processa `pending_fire` de cada nave: cria projéteis e zera o flag.
    fn try_fire_weapons(&mut self) {
        let ship_ids: Vec<EntityId> = self.ships.keys().copied().collect();
        for id in ship_ids {
            let (pos, vel, rot, mut ship) = self.ships[&id].clone();
            ship.fire_cooldown = (ship.fire_cooldown - self.last_dt).max(0.0);
            ship.torpedo_cooldown = (ship.torpedo_cooldown - self.last_dt).max(0.0);
            // Nave paralisada por PEM não atira. É metade do efeito da
            // habilidade; a outra metade é o empuxo cortado abaixo.
            if ship.pending_fire && ship.fire_cooldown <= 0.0 && ship.emp_remaining <= 0.0 {
                ship.pending_fire = false;
                let carga = ship.pending_charge;
                ship.pending_charge = 0.0;
                // Cadencia vem da ARMA equipada e cresce com a carga: um
                // tiro cheio custa uma pausa maior, senao carregar seria
                // sempre melhor que atirar em rajada.
                ship.fire_cooldown = ship.weapon.cooldown_after_charge(carga);

                // Cria projétil na ponta da nave, com velocidade
                // do ship + forward * projectile_speed.
                let fwd = forward(&rot);
                // O disparo herda a CARGA acumulada: dano, velocidade,
                // raio e alcance escalam com o tempo de gatilho segurado.
                let tiro = ship.weapon.charged(carga);
                let proj = Projectile {
                    owner_player_id: ship.owner_player_id,
                    owner_entity: id,
                    damage: tiro.damage,
                    ttl_remaining: tiro.ttl,
                    radius: tiro.radius,
                    speed: tiro.speed,
                    splash_radius: tiro.splash_radius,
                    visual: ship.weapon.visual.to_index(),
                    charge: tiro.charge,
                };
                let proj_vel = Velocity {
                    x: vel.x + fwd[0] * proj.speed,
                    y: vel.y + fwd[1] * proj.speed,
                    z: vel.z + fwd[2] * proj.speed,
                };
                let proj_pos = Position {
                    x: pos.x + fwd[0] * 3.0,
                    y: pos.y + fwd[1] * 3.0,
                    z: pos.z + fwd[2] * 3.0,
                };
                let proj_id = self.alloc_id();
                self.projectiles.insert(proj_id, (proj_pos, proj_vel, proj));
                // Clarão de boca, para o cliente desenhar no lugar certo.
                self.events.push(crate::net::protocol::ServerMsg::Vfx {
                    effect_id: VFX_MUZZLE,
                    pos: [proj_pos.x, proj_pos.y, proj_pos.z],
                });
            }
            self.ships.insert(id, (pos, vel, rot, ship));
        }
    }

    /// Detecta colisões projétil-vs-nave. Aplica dano e marca destruídos.
    /// Colisão projétil x nave usando grade espacial uniforme.
    ///
    /// A versão anterior comparava todo projétil contra toda nave —
    /// O(P.S) por tick, que com 50 jogadores em combate vira dezenas de
    /// milhares de testes a 30Hz. Agora cada nave é indexada na célula da
    /// grade e cada projétil só testa as 27 células vizinhas, então o
    /// custo cresce com a densidade local, não com o total do mundo.
    fn check_projectile_collisions(&mut self) {
        if self.projectiles.is_empty() || self.ships.is_empty() {
            return;
        }
        // Guarda o segmento percorrido no tick (origem -> destino).
        //
        // Testar só o ponto final causava tunneling: o projétil nasce 3
        // unidades à frente e a física já o leva para 6.3 antes da
        // checagem, passando por cima de qualquer alvo próximo. Com as
        // armas rápidas (até 320 m/s = 10.7 por tick) o problema piora.
        let dt = self.last_dt;
        let proj_snapshot: Vec<(EntityId, Position, Position, f32, EntityId)> = self
            .projectiles
            .iter()
            .map(|(id, (p, v, proj))| {
                let anterior = Position {
                    x: p.x - v.x * dt,
                    y: p.y - v.y * dt,
                    z: p.z - v.z * dt,
                };
                (*id, anterior, *p, proj.radius, proj.owner_entity)
            })
            .collect();
        let ship_snapshot: Vec<(EntityId, Position, f32, u32)> = self
            .ships
            .iter()
            // Naves em dobra nao sao alvo: a imunidade vale para tudo,
            // senao o salto seria uma armadilha em vez de uma fuga.
            .filter(|(_, (_, _, _, s))| s.warp_remaining <= 0.0)
            .map(|(id, (p, _, _, s))| (*id, *p, s.radius, s.owner_player_id))
            .collect();

        // Índice espacial das naves. A célula é maior que a soma dos raios,
        // então nenhuma colisão escapa da vizinhança 3x3x3 testada.
        let mut grid: HashMap<GridCell, Vec<usize>> = HashMap::new();
        for (idx, (_, p, _, _)) in ship_snapshot.iter().enumerate() {
            grid.entry(cell_of(*p)).or_default().push(idx);
        }

        let mut ships_to_damage: Vec<(EntityId, f32, u32, u32)> = Vec::new();
        let mut projs_to_remove: Vec<EntityId> = Vec::new();

        for (proj_id, p0, p1, pr, atirador) in &proj_snapshot {
            for ship_idx in neighbors_of(&grid, *p1) {
                let Some((ship_id, sp, sr, ship_owner)) = ship_snapshot.get(ship_idx) else {
                    continue;
                };
                // Nunca acerta quem disparou: o projétil nasce dentro da
                // própria esfera de colisão da nave.
                if ship_id == atirador {
                    continue;
                }
                // Distância do CENTRO da nave ao segmento percorrido.
                let dist_sq = point_segment_dist_sq(*sp, *p0, *p1);
                let r = pr + sr;
                if dist_sq < r * r {
                    let proj_owner = self.projectiles.get(proj_id).map(|(_, _, p)| p.owner_player_id).unwrap_or(0);
                    let mut can_damage = true;
                    
                    if proj_owner != 0 && *ship_owner != 0 {
                        if proj_owner == *ship_owner {
                            can_damage = false; // No self damage
                        } else if let (Some(party_a), Some(party_b)) = (self.parties.get(&proj_owner), self.parties.get(ship_owner)) {
                            if party_a == party_b {
                                can_damage = false; // Friendly fire prevented
                            }
                        }
                    }

                    if !can_damage {
                        // Atravessa aliados e o próprio atirador em vez
                        // de ser consumido.
                        //
                        // Antes o projétil era destruído aqui: como todas
                        // as naves nascem na origem, o tiro colidia com a
                        // própria nave e sumia — nenhum disparo chegava
                        // ao alvo, e o combate simplesmente não funcionava.
                        continue;
                    }

                    // Acha o dano do projétil correspondente.
                    let damage = self
                        .projectiles
                        .get(proj_id)
                        .map(|(_, _, proj)| proj.damage)
                        .unwrap_or(0.0);
                    ships_to_damage.push((*ship_id, damage, *ship_owner, proj_owner));
                    projs_to_remove.push(*proj_id);
                    break; // projétil é consumido pelo alvo válido
                }
            }
        }

        // Dano em ÁREA: armas pesadas atingem quem está perto do
        // impacto, não só o alvo direto. Calculado antes de aplicar,
        // usando a posição do projétil que colidiu.
        let mut splash: Vec<(EntityId, f32, u32, u32)> = Vec::new();
        for (proj_id, _p0, pp, _pr, _atk) in &proj_snapshot {
            if !projs_to_remove.contains(proj_id) {
                continue;
            }
            let Some((_, _, proj)) = self.projectiles.get(proj_id) else { continue };
            if proj.splash_radius <= 0.0 {
                continue;
            }
            let raio = proj.splash_radius;
            let atacante = proj.owner_player_id;
            for (ship_id, sp, _sr, ship_owner) in &ship_snapshot {
                let d2 = (pp.x - sp.x).powi(2) + (pp.y - sp.y).powi(2) + (pp.z - sp.z).powi(2);
                if d2 > raio * raio {
                    continue;
                }
                // Amigo e o próprio atirador não levam respingo.
                if atacante != 0 && *ship_owner != 0 {
                    if atacante == *ship_owner {
                        continue;
                    }
                    if let (Some(a), Some(b)) =
                        (self.parties.get(&atacante), self.parties.get(ship_owner))
                    {
                        if a == b {
                            continue;
                        }
                    }
                }
                // Queda linear com a distância: no epicentro é dano
                // cheio, na borda do raio é zero.
                let d = d2.sqrt();
                let fator = (1.0 - d / raio).clamp(0.0, 1.0);
                splash.push((*ship_id, proj.damage * fator * 0.6, *ship_owner, atacante));
            }
            // O impacto tem que PAGAR a carga. Um tiro segurado até o
            // fim, ou uma arma de respingo, estoura em vez de faiscar —
            // sem isso o jogador via a barra encher, soltava, e o acerto
            // era idêntico ao de um toque de laser.
            let pesado = proj.charge >= 0.45 || proj.splash_radius >= 10.0;
            self.events.push(crate::net::protocol::ServerMsg::Vfx {
                effect_id: if pesado { VFX_EXPLOSION_LARGE } else { VFX_IMPACT },
                pos: [pp.x, pp.y, pp.z],
            });
        }
        ships_to_damage.extend(splash);

        // Soma o dano por nave em vez de descartar duplicatas: dois
        // projéteis no mesmo tick precisam somar, não valer por um.
        let mut por_nave: HashMap<EntityId, (f32, u32)> = HashMap::new();
        for (ship_id, dmg, _owner, attacker_id) in ships_to_damage {
            let e = por_nave.entry(ship_id).or_insert((0.0, attacker_id));
            e.0 += dmg;
            if e.1 == 0 {
                e.1 = attacker_id;
            }
        }

        for (ship_id, (dmg, attacker_id)) in por_nave {
            if let Some((p, v, r, ship)) = self.ships.get(&ship_id).cloned() {
                let mut new_ship = ship;

                // Perfuração de blindagem do ATACANTE (skill "Armor
                // Piercing"): esta fração ignora o escudo e vai direto
                // ao casco. É o que dá sentido ao ramo de combate contra
                // alvos muito escudados.
                let pierce = self
                    .player_ships
                    .get(&attacker_id)
                    .and_then(|sid| self.ships.get(sid))
                    .map(|(_, _, _, s)| s.shield_pierce)
                    .unwrap_or(0.0)
                    .clamp(0.0, 1.0);
                let direto = dmg * pierce;
                let contra_escudo = dmg - direto;

                // O ESCUDO absorve primeiro; só o excedente vai ao casco.
                // Antes o dano ia direto no casco e os escudos vendidos
                // na loja não tinham efeito nenhum.
                let absorvido = contra_escudo.min(new_ship.shield_hp);
                new_ship.shield_hp -= absorvido;
                let restante = contra_escudo - absorvido + direto;
                new_ship.hull_hp = (new_ship.hull_hp - restante).max(0.0);

                if new_ship.hull_hp <= 0.0 {
                    self.destroyed.push((
                        ship_id,
                        if attacker_id != 0 { Some(attacker_id) } else { None },
                    ));
                }
                self.ships.insert(ship_id, (p, v, r, new_ship));
            }
        }

        // Remove projéteis consumidos.
        for id in projs_to_remove {
            self.projectiles.remove(&id);
        }
    }

    /// Retorna e limpa a lista de entidades destruídas no último step.
    pub fn take_destroyed(&mut self) -> Vec<(EntityId, Option<u32>)> {
        std::mem::take(&mut self.destroyed)
    }

    /// Retorna e limpa a lista de eventos efêmeros do último step.
    pub fn take_events(&mut self) -> Vec<crate::net::protocol::ServerMsg> {
        std::mem::take(&mut self.events)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_input(
        &mut self,
        player_id: u32,
        steer: f32,
        pitch: f32,
        roll: f32,
        thrust: f32,
        fire: bool,
        fire_charge: f32,
        skill: Option<ActiveSkill>,
        use_consumable: Option<u8>,
    ) {
        // Lookup direto pelo índice, em vez de varrer todas as naves.
        let Some(&id) = self.player_ships.get(&player_id) else {
            return;
        };
        let Some((_, _, _, ship)) = self.ships.get_mut(&id) else {
            // Nave morreu mas o índice ficou: limpa para não repetir a busca.
            self.player_ships.remove(&player_id);
            return;
        };
        ship.steer_input = steer.clamp(-1.0, 1.0);
        ship.pitch_input = pitch.clamp(-1.0, 1.0);
        ship.roll_input = roll.clamp(-1.0, 1.0);
        ship.thrust_input = thrust.clamp(0.0, 1.0);
        if fire {
            ship.pending_fire = true;
            // Guarda o maior valor até o disparo sair: se dois pacotes
            // chegarem no mesmo tick, vale a carga mais completa.
            ship.pending_charge = ship.pending_charge.max(fire_charge.clamp(0.0, 10.0));
        }
        if use_consumable.is_some() {
            ship.consumable_input = use_consumable;
        }
        if skill.is_some() {
            ship.skill_input = skill;
        }
    }

    /// Avança a simulação em `dt` segundos (fixed timestep recomendado: 1/30).
    pub fn step(&mut self, dt: f32) {
        self.elapsed += dt;
        self.tick += 1;
        self.last_dt = dt;

        // Processa skills e atualiza timers.
        //
        // Os pulsos de PEM são coletados aqui e aplicados depois: dentro
        // do laço `self.ships` está emprestado, e o efeito precisa
        // alcançar OUTRAS naves.
        let mut pulsos_emp: Vec<(EntityId, u32, Position)> = Vec::new();
        let mut iscas_pedidas: Vec<(Position, u32)> = Vec::new();
        let ship_ids: Vec<EntityId> = self.ships.keys().copied().collect();
        for id in ship_ids.iter() {
            let (pos_atual, _, _, mut ship) = self.ships[id].clone();
            ship.skills.tick(dt);
            ship.belt.tick(dt);
            if ship.emp_remaining > 0.0 {
                ship.emp_remaining = (ship.emp_remaining - dt).max(0.0);
            }

            // --- Consumível pedido pelo jogador ---
            if let Some(slot) = ship.consumable_input.take() {
                use sim_core::ship::consumables::{ConsumableEffect, UseOutcome};
                if let UseOutcome::Used { effect, vfx } = ship.belt.use_slot(slot as usize) {
                    match effect {
                        ConsumableEffect::RepairHull { amount } => {
                            ship.hull_hp = (ship.hull_hp + amount).min(ship.hull_max);
                        }
                        ConsumableEffect::RestoreShield { amount } => {
                            ship.shield_hp = (ship.shield_hp + amount).min(ship.shield_max);
                        }
                        // As iscas entram na fila para depois do laço:
                        // aqui `self.ships` está emprestado, e soltar
                        // iscas mexe em `self.decoys`.
                        ConsumableEffect::DeployDecoys => {
                            iscas_pedidas.push((pos_atual, ship.owner_player_id));
                        }
                    }
                    self.events.push(crate::net::protocol::ServerMsg::ConsumableUsed {
                        entity_id: *id,
                        slot,
                        vfx,
                        charges_left: ship.belt.charges_at(slot as usize),
                    });
                }
            }

            // Ativa a skill solicitada, se houver
            if let Some(requested_skill) = ship.skill_input.take() {
                if ship.skills.use_skill(requested_skill) {
                    // Dash agora é um SALTO DE DOBRA: aceleração enorme,
                    // imunidade a colisão e rastro de vórtices.
                    if requested_skill == ActiveSkill::Dash {
                        ship.warp_remaining = ship.warp.duration;
                        ship.vortex_timer = 0.0;
                    }
                    // O PEM paralisa quem estiver no raio. Guardamos os
                    // alvos para aplicar fora deste laço — `self.ships`
                    // está emprestado aqui.
                    if requested_skill == ActiveSkill::Emp {
                        pulsos_emp.push((*id, ship.owner_player_id, pos_atual));
                    }
                    self.events.push(crate::net::protocol::ServerMsg::SkillActivated {
                        entity_id: *id,
                        skill: requested_skill,
                    });
                }
            }
            
            // --- Reparo: cura contínua enquanto o efeito dura ---
            //
            // DEPOIS da ativação de propósito: checar antes gastava um
            // tick à toa, e o jogador que aperta 3 com o casco crítico
            // via o número parado por 33ms. Cura ao longo do tempo, ao
            // contrário do consumível, que é instantâneo e escasso.
            if ship.skills.effect_remaining(ActiveSkill::Repair) > 0.0 {
                let cura = ActiveSkill::Repair.heal_per_sec() * dt;
                ship.hull_hp = (ship.hull_hp + cura).min(ship.hull_max);
            }

            // Re-insere na collection para salvar o estado
            self.ships.get_mut(id).unwrap().3 = ship;
        }

        // Iscas pedidas pelos slots numerados (as da tecla F passam por
        // `deploy_decoys`, que faz a mesma coisa).
        for (p, dono) in iscas_pedidas {
            self.decoys.push((p, DECOY_TTL, dono));
            self.events.push(crate::net::protocol::ServerMsg::Vfx {
                effect_id: VFX_DECOY,
                pos: [p.x, p.y, p.z],
            });
        }

        // --- PEM: paralisa naves inimigas no raio ---
        //
        // Só inimigos: um pulso que derrubasse o próprio esquadrão
        // tornaria a habilidade inutilizável em grupo, que é justamente
        // onde ela deveria brilhar.
        for (origem, dono, centro) in pulsos_emp {
            let raio2 = ActiveSkill::Emp.radius().powi(2);
            let duracao = ActiveSkill::Emp.duration_secs();
            let alvos: Vec<EntityId> = self
                .ships
                .iter()
                .filter(|(alvo_id, (p, _, _, s))| {
                    **alvo_id != origem && s.owner_player_id != dono && dist_sq(*p, centro) <= raio2
                })
                .map(|(alvo_id, _)| *alvo_id)
                .collect();
            for alvo in alvos {
                if let Some((_, _, _, s)) = self.ships.get_mut(&alvo) {
                    s.emp_remaining = s.emp_remaining.max(duracao);
                }
            }
            self.events.push(crate::net::protocol::ServerMsg::Vfx {
                effect_id: VFX_EMP,
                pos: [centro.x, centro.y, centro.z],
            });
        }

        // Física de naves.
        let ship_ids: Vec<EntityId> = self.ships.keys().copied().collect();
        for id in ship_ids {
            let (pos, vel, rot, ship) = self.ships[&id].clone();
            
            // Em dobra o empuxo é multiplicado; fora dela, normal.
            // Sob PEM, zero: a nave fica à deriva com a inércia que
            // tinha, que é o que torna o pulso perigoso perto de um
            // poço gravitacional.
            let em_dobra = ship.warp_remaining > 0.0;
            let sob_emp = ship.emp_remaining > 0.0;
            let thrust_capacity = if sob_emp {
                0.0
            } else if em_dobra {
                ship.thrust_capacity * ship.warp.thrust_multiplier
            } else {
                ship.thrust_capacity
            };

            // Rotação nos três eixos, aplicada no referencial LOCAL da
            // nave. Compor no espaço local é o que faz o controle
            // parecer natural: depois de rolar 90°, puxar o nariz
            // continua sendo "para cima em relação à cabine", e não
            // para o norte do mundo.
            let rate = ship.turn_rate * dt;
            // Os sinais são NEGADOS de propósito.
            //
            // A frente é +Z e a câmera fica atrás, olhando ao longo de
            // +Z com +Y para cima. Nesse referencial a direita da tela é
            // -X (right = forward x up). Uma rotação positiva em torno de
            // +Y leva o nariz de +Z para +X, ou seja, para a ESQUERDA da
            // tela; e uma rotação positiva em torno de +X leva o nariz
            // para -Y, ou seja, para BAIXO.
            //
            // Sem a negação, `steer:+1` virava à esquerda e `pitch:+1`
            // abaixava o nariz — os controles pareciam invertidos em
            // relação à nave. O contrato do protocolo é o intuitivo:
            // +1 = direita / nariz para cima.
            let new_rot = rotate_local(
                &rot,
                -ship.pitch_input * rate,
                -ship.steer_input * rate,
                ship.roll_input * rate,
            );
            // Thrust no eixo forward (local +Z → world +Z após rotação identity).
            let fwd = forward(&new_rot);
            let accel = thrust_capacity * ship.thrust_input;
            let drag_factor = (1.0 - ship.drag * dt).max(0.0);
            // Gravidade dos corpos celestes. Somada ANTES do arrasto:
            // o arrasto representa resistência ao movimento próprio, não
            // deve cancelar a queda livre.
            let g = self.gravity_accel([pos.x, pos.y, pos.z]);

            let new_vel = Velocity {
                x: (vel.x + (fwd[0] * accel + g[0]) * dt) * drag_factor,
                y: (vel.y + (fwd[1] * accel + g[1]) * dt) * drag_factor,
                z: (vel.z + (fwd[2] * accel + g[2]) * dt) * drag_factor,
            };
            let mut new_vel = new_vel;
            let mut ship = ship;

            if em_dobra {
                // Empurrao inicial: sem ele, dobrar parado quase nao sai
                // do lugar — o salto e curto e a aceleracao precisa de
                // tempo. So aplicado abaixo do piso, para nao somar sem
                // limite ao longo do salto.
                let vel_atual = (new_vel.x * new_vel.x
                    + new_vel.y * new_vel.y
                    + new_vel.z * new_vel.z)
                    .sqrt();
                if vel_atual < ship.warp.kick_speed {
                    let fwd2 = forward(&new_rot);
                    let falta = ship.warp.kick_speed - vel_atual;
                    new_vel.x += fwd2[0] * falta;
                    new_vel.y += fwd2[1] * falta;
                    new_vel.z += fwd2[2] * falta;
                }

                // Rastro: um vortice a cada intervalo.
                ship.vortex_timer -= dt;
                if ship.vortex_timer <= 0.0 {
                    ship.vortex_timer = ship.warp.vortex_interval;
                    let f = forward(&new_rot);
                    self.pending_vortices.push(sim_core::ship::warp::Vortex {
                        pos: [pos.x, pos.y, pos.z],
                        dir: [f[0], f[1], f[2]],
                        radius: ship.warp.vortex_radius,
                        boost: ship.warp.vortex_boost,
                        ttl_remaining: ship.warp.vortex_ttl,
                        ttl_total: ship.warp.vortex_ttl,
                        owner_player_id: ship.owner_player_id,
                    });
                }
                ship.warp_remaining = (ship.warp_remaining - dt).max(0.0);
            }

            let new_pos = Position {
                x: pos.x + new_vel.x * dt,
                y: pos.y + new_vel.y * dt,
                z: pos.z + new_vel.z * dt,
            };
            // Cooldown e decrementado em try_fire_weapons.
            self.ships.insert(id, (new_pos, new_vel, new_rot, ship));
        }

        // Regeneração de escudo. Só o escudo regenera; o casco exige
        // reparo (habilidade ou hangar), senão não haveria risco real.
        for (_, _, _, ship) in self.ships.values_mut() {
            if ship.shield_regen > 0.0 && ship.shield_hp < ship.shield_max {
                ship.shield_hp = (ship.shield_hp + ship.shield_regen * dt).min(ship.shield_max);
            }
        }

        // Armas: cria projéteis e gerencia cooldown.
        self.try_fire_weapons();

        // Física de projéteis + TTL.
        let proj_ids: Vec<EntityId> = self.projectiles.keys().copied().collect();
        let mut to_remove = Vec::new();
        for id in proj_ids {
            let (pos, vel, mut proj) = self.projectiles.remove(&id).unwrap();
            proj.ttl_remaining -= dt;
            if proj.ttl_remaining <= 0.0 {
                to_remove.push(id);
                self.destroyed.push((id, None));
                continue;
            }
            // Projéteis também caem. Perto de um planeta o tiro
            // encurva, e disparar através de um poço gravitacional passa
            // a exigir mirar "ao lado" do alvo. Sem isso, a gravidade
            // valia só para as naves e o combate ignorava o cenário.
            let g = self.gravity_accel([pos.x, pos.y, pos.z]);
            let new_vel = Velocity {
                x: vel.x + g[0] * dt,
                y: vel.y + g[1] * dt,
                z: vel.z + g[2] * dt,
            };
            let new_pos = Position {
                x: pos.x + new_vel.x * dt,
                y: pos.y + new_vel.y * dt,
                z: pos.z + new_vel.z * dt,
            };
            self.projectiles.insert(id, (new_pos, new_vel, proj));
        }
        for id in to_remove {
            self.projectiles.remove(&id);
        }

        // Vortices de dobra: materializa os novos, impulsiona quem
        // estiver dentro e expira os velhos.
        self.step_vortices(dt);

        // Efeitos ambientais dos corpos celestes (calor, atmosfera).
        self.apply_body_hazards(dt);

        // Colisões: dano + destruição de naves.
        self.step_training(dt);
        self.check_projectile_collisions();
        // Torpedos DEPOIS da colisão normal: um projétil que já acertou
        // uma nave não deve também abater um torpedo no mesmo tick.
        self.step_torpedoes(dt);
        self.projectiles_vs_torpedoes();
        // Impacto contra planeta/estrela — depois dos projéteis, para
        // que a explosão de queda tenha prioridade na leitura.
        self.check_celestial_collisions();

        // Remove naves destruídas (hull_hp <= 0).
        let mut to_drop: Vec<EntityId> = Vec::new();
        for (id, (_, _, _, ship)) in &self.ships {
            if ship.hull_hp <= 0.0 {
                to_drop.push(*id);
            }
        }
        for id in &to_drop {
            if let Some((pos, _, _, ship)) = self.ships.remove(id) {
                // Mantém o índice player->nave coerente com `ships`.
                self.player_ships.remove(&ship.owner_player_id);
                // Explosão no lugar exato onde a nave estava.
                self.events.push(crate::net::protocol::ServerMsg::Vfx {
                    effect_id: VFX_EXPLOSION_SHIP,
                    pos: [pos.x, pos.y, pos.z],
                });
            }
            // Garante que está em destroyed (já adicionado em check_projectile_collisions).
            if !self.destroyed.iter().any(|(d, _)| d == id) {
                self.destroyed.push((*id, None));
            }
        }

        // Wrecks: decrementa TTL e remove expirados.
        let mut wrecks_expired: Vec<EntityId> = Vec::new();
        for (id, (_, w)) in &mut self.wrecks {
            if w.ttl_remaining > 0 {
                w.ttl_remaining = w.ttl_remaining.saturating_sub(1);
            }
            if w.ttl_remaining == 0 {
                wrecks_expired.push(*id);
            }
        }
        for id in &wrecks_expired {
            self.wrecks.remove(id);
            if !self.destroyed.iter().any(|(d, _)| d == id) {
                self.destroyed.push((*id, None));
            }
        }
    }

    /// Aceleração gravitacional resultante de TODOS os corpos em `pos`.
    ///
    /// A soma é sobre poucos corpos (uma dezena), e `gravity_at` já
    /// devolve zero fora do raio de influência — não vale a pena um
    /// índice espacial aqui.
    pub fn gravity_accel(&self, pos: [f32; 3]) -> [f32; 3] {
        let mut acc = [0.0f32; 3];
        for b in &self.bodies {
            let g = sim_core::worldgen::celestial::gravity_at(b, pos);
            acc[0] += g[0];
            acc[1] += g[1];
            acc[2] += g[2];
        }
        acc
    }

    /// Corpo cujo poço de captura contém `pos`, se houver.
    ///
    /// Alimenta o aviso de "preso na gravidade" no HUD. Devolve o mais
    /// próximo quando há sobreposição (planeta + lua, por exemplo).
    pub fn dominant_body_at(
        &self,
        pos: [f32; 3],
    ) -> Option<(&sim_core::worldgen::celestial::CelestialBody, f32)> {
        let mut melhor: Option<(&sim_core::worldgen::celestial::CelestialBody, f32)> = None;
        for b in &self.bodies {
            let d = ((b.pos[0] - pos[0]).powi(2)
                + (b.pos[1] - pos[1]).powi(2)
                + (b.pos[2] - pos[2]).powi(2))
            .sqrt();
            if d <= b.capture_radius() && melhor.is_none_or(|(_, md)| d < md) {
                melhor = Some((b, d));
            }
        }
        melhor
    }

    /// Materializa, aplica e expira os vortices de dobra.
    ///
    /// O vortice e o que transforma a dobra numa mecanica de PERSEGUICAO:
    /// quem foge deixa uma estrada aberta, e quem persegue pode usa-la.
    fn step_vortices(&mut self, dt: f32) {
        for v in std::mem::take(&mut self.pending_vortices) {
            let id = self.alloc_id();
            self.vortices.push((id, v));
        }
        if self.vortices.is_empty() {
            return;
        }

        // Impulso em quem esta dentro.
        let mut impulsos: Vec<(EntityId, [f32; 3])> = Vec::new();
        for (ship_id, (pos, _, _, ship)) in &self.ships {
            let mut acc = [0.0f32; 3];
            for (_, v) in &self.vortices {
                let imp = sim_core::ship::warp::vortex_impulse(
                    v,
                    [pos.x, pos.y, pos.z],
                    ship.owner_player_id,
                    ship.vortex_gain,
                );
                acc[0] += imp[0];
                acc[1] += imp[1];
                acc[2] += imp[2];
            }
            if acc[0] != 0.0 || acc[1] != 0.0 || acc[2] != 0.0 {
                impulsos.push((*ship_id, acc));
            }
        }
        for (id, imp) in impulsos {
            if let Some((_, vel, _, _)) = self.ships.get_mut(&id) {
                // Impulso e por segundo: sem `dt` a forca dependeria do
                // tick rate do servidor.
                vel.x += imp[0] * dt;
                vel.y += imp[1] * dt;
                vel.z += imp[2] * dt;
            }
        }

        // Expira.
        let mut mortos: Vec<EntityId> = Vec::new();
        for (id, v) in &mut self.vortices {
            v.ttl_remaining -= dt;
            if v.ttl_remaining <= 0.0 {
                mortos.push(*id);
            }
        }
        if !mortos.is_empty() {
            self.vortices.retain(|(id, _)| !mortos.contains(id));
            for id in mortos {
                self.destroyed.push((id, None));
            }
        }
    }

    /// Aplica os efeitos AMBIENTAIS dos corpos sobre as naves dentro do
    /// raio de captura.
    ///
    /// É o que faz cada tipo de corpo jogar diferente: a estrela queima,
    /// o gigante gasoso freia com atmosfera, o planeta comum só puxa.
    /// Sem isso, aproximar-se de qualquer corpo era a mesma experiência.
    fn apply_body_hazards(&mut self, dt: f32) {
        if self.bodies.is_empty() {
            return;
        }

        // Coleta antes de mutar: precisamos de `&self.bodies` e
        // `&mut self.ships` ao mesmo tempo.
        let mut efeitos: Vec<(EntityId, f32, f32)> = Vec::new();
        for (id, (pos, _, _, _)) in &self.ships {
            let mut dano = 0.0f32;
            let mut arrasto = 0.0f32;
            for b in &self.bodies {
                let d2 = (b.pos[0] - pos.x).powi(2)
                    + (b.pos[1] - pos.y).powi(2)
                    + (b.pos[2] - pos.z).powi(2);
                let captura = b.capture_radius();
                if d2 > captura * captura {
                    continue;
                }
                // Intensidade cresce ao aproximar: na borda do raio de
                // captura o efeito é quase nulo, na superfície é máximo.
                let d = d2.sqrt().max(b.radius);
                let t = (1.0 - (d - b.radius) / (captura - b.radius).max(1.0)).clamp(0.0, 1.0);
                dano += b.kind.heat_damage() * t;
                arrasto += b.kind.atmospheric_drag() * t;
            }
            if dano > 0.0 || arrasto > 0.0 {
                efeitos.push((*id, dano, arrasto));
            }
        }

        for (id, dano, arrasto) in efeitos {
            let Some((pos, vel, _, ship)) = self.ships.get_mut(&id) else { continue };

            if dano > 0.0 {
                // Calor atravessa o escudo: é ambiente, não impacto.
                let total = dano * dt;
                ship.hull_hp = (ship.hull_hp - total).max(0.0);
            }
            if arrasto > 0.0 {
                let f = (1.0 - arrasto * dt).max(0.0);
                vel.x *= f;
                vel.y *= f;
                vel.z *= f;
            }
            let _ = pos;
        }
    }

    /// Destrói naves e projéteis que tocaram a superfície de um corpo.
    ///
    /// Sem isso, cair na gravidade terminaria com a nave atravessando o
    /// planeta e saindo do outro lado.
    fn check_celestial_collisions(&mut self) {
        if self.bodies.is_empty() {
            return;
        }

        let mut naves_atingidas: Vec<EntityId> = Vec::new();
        for (id, (pos, _, _, ship)) in &self.ships {
            // Em dobra a nave atravessa obstaculos: e o ponto do salto —
            // ir de um lugar a outro ignorando o que estiver no caminho.
            if ship.warp_remaining > 0.0 {
                continue;
            }
            for b in &self.bodies {
                let d2 = (b.pos[0] - pos.x).powi(2)
                    + (b.pos[1] - pos.y).powi(2)
                    + (b.pos[2] - pos.z).powi(2);
                let limite = b.radius + ship.radius;
                if d2 <= limite * limite {
                    naves_atingidas.push(*id);
                    break;
                }
            }
        }
        for id in naves_atingidas {
            if let Some((pos, _, _, ship)) = self.ships.get_mut(&id) {
                // Impacto em corpo celeste é fatal, não gradual.
                ship.hull_hp = 0.0;
                let p = *pos;
                self.events.push(crate::net::protocol::ServerMsg::Vfx {
                    effect_id: VFX_EXPLOSION_LARGE,
                    pos: [p.x, p.y, p.z],
                });
            }
        }

        let mut projeteis_atingidos: Vec<EntityId> = Vec::new();
        for (id, (pos, _, _)) in &self.projectiles {
            for b in &self.bodies {
                let d2 = (b.pos[0] - pos.x).powi(2)
                    + (b.pos[1] - pos.y).powi(2)
                    + (b.pos[2] - pos.z).powi(2);
                if d2 <= b.radius * b.radius {
                    projeteis_atingidos.push(*id);
                    break;
                }
            }
        }
        for id in projeteis_atingidos {
            self.projectiles.remove(&id);
            self.destroyed.push((id, None));
        }
    }

    /// Hash determinístico do estado (para testes de determinismo).
    pub fn state_hash(&self) -> u64 {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        let mut h = DefaultHasher::new();
        self.tick.hash(&mut h);
        let mut ids: Vec<_> = self.ships.keys().collect();
        ids.sort();
        for id in ids {
            id.hash(&mut h);
            let (p, v, r, s) = &self.ships[id];
            pos_to_bits(*p).hash(&mut h);
            vel_to_bits(*v).hash(&mut h);
            rot_to_bits(*r).hash(&mut h);
            (s.hull_hp as u32).hash(&mut h);
        }
        h.finish()
    }
}

/// Compõe pitch (X), yaw (Y) e roll (Z) no referencial local da nave.
///
/// `r * q_pitch * q_yaw * q_roll` — multiplicar à DIREITA aplica no eixo
/// local; à esquerda aplicaria no eixo do mundo, e a nave giraria em
/// torno do norte absoluto mesmo de cabeça para baixo.
pub fn rotate_local(r: &Rotation, pitch: f32, yaw: f32, roll: f32) -> Rotation {
    let mut out = *r;
    if pitch != 0.0 {
        out = mul_quat(&out, &axis_angle(1.0, 0.0, 0.0, pitch));
    }
    if yaw != 0.0 {
        out = mul_quat(&out, &axis_angle(0.0, 1.0, 0.0, yaw));
    }
    if roll != 0.0 {
        out = mul_quat(&out, &axis_angle(0.0, 0.0, 1.0, roll));
    }
    normalize_quat(&out)
}

/// Quaternion de rotação `angle` radianos em torno de um eixo unitário.
fn axis_angle(x: f32, y: f32, z: f32, angle: f32) -> Rotation {
    let half = angle * 0.5;
    let s = half.sin();
    Rotation { x: x * s, y: y * s, z: z * s, w: half.cos() }
}

/// Produto de Hamilton `a * b`.
fn mul_quat(a: &Rotation, b: &Rotation) -> Rotation {
    Rotation {
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    }
}

/// Renormaliza. Sem isto, o erro de ponto flutuante acumula ao longo de
/// milhares de ticks e a nave começa a deformar/escorregar.
fn normalize_quat(q: &Rotation) -> Rotation {
    let len = (q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w).sqrt();
    if len <= f32::EPSILON {
        return Rotation { x: 0.0, y: 0.0, z: 0.0, w: 1.0 };
    }
    Rotation { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len }
}

#[allow(dead_code)]
fn rotate_y(r: &Rotation, angle: f32) -> Rotation {
    // Hamilton product: r * (0, sin(angle/2), 0, cos(angle/2)).
    // Rotação ao redor do eixo Y (yaw).
    let half = angle * 0.5;
    let (s, c) = half.sin_cos();
    Rotation {
        x: r.x * c - r.z * s,
        y: r.w * s + r.y * c,
        z: r.x * s + r.z * c,
        w: r.w * c - r.y * s,
    }
}

fn forward(r: &Rotation) -> [f32; 3] {
    // Para quaternion (0,0,0,1) (identity), forward = (0,0,1).
    // Fórmula geral: 2 * (q.x*q.z + q.w*q.y), 2*(q.y*q.z - q.w*q.x), 1 - 2*(q.x²+q.y²)
    [
        2.0 * (r.x * r.z + r.w * r.y),
        2.0 * (r.y * r.z - r.w * r.x),
        1.0 - 2.0 * (r.x * r.x + r.y * r.y),
    ]
}

#[allow(dead_code)]
fn pos_to_bits(p: Position) -> [u32; 3] { [p.x.to_bits(), p.y.to_bits(), p.z.to_bits()] }
#[allow(dead_code)]
fn vel_to_bits(v: Velocity) -> [u32; 3] { [v.x.to_bits(), v.y.to_bits(), v.z.to_bits()] }
#[allow(dead_code)]
fn rot_to_bits(r: Rotation) -> [u32; 4] { [r.x.to_bits(), r.y.to_bits(), r.z.to_bits(), r.w.to_bits()] }

/// Arrasto linear da nave de jogador.
///
/// Nomeado porque o cliente precisa do MESMO valor para prever a
/// Espera entre lançamentos de torpedo, em segundos.
///
/// Alta de propósito: um lançador de repetição transformaria o combate
/// em administrar torpedos em vez de pilotar.
const TORPEDO_COOLDOWN: f32 = 9.0;
/// Quanto tempo as iscas de dispersão continuam confundindo, em segundos.
const DECOY_TTL: f32 = 4.0;
/// Distância em que uma isca ainda cobre a nave.
const DECOY_RADIUS: f32 = 90.0;

/// trajetória sob gravidade — ele chega no `Sector`.
pub const PLAYER_SHIP_DRAG: f32 = 0.5;

/// Coordenada de célula da grade espacial de colisão.
type GridCell = (i32, i32, i32);

/// Lado da célula. Precisa ser maior que a soma dos maiores raios de
/// colisão (naves 5, projéteis 0.5), senão um par colidindo poderia
/// cair fora da vizinhança 3x3x3 testada.
const CELL_SIZE: f32 = 32.0;

fn cell_of(p: Position) -> GridCell {
    (
        (p.x / CELL_SIZE).floor() as i32,
        (p.y / CELL_SIZE).floor() as i32,
        (p.z / CELL_SIZE).floor() as i32,
    )
}

/// Índices das naves nas 27 células ao redor de `p`.
fn neighbors_of(grid: &HashMap<GridCell, Vec<usize>>, p: Position) -> Vec<usize> {
    let (cx, cy, cz) = cell_of(p);
    let mut out = Vec::new();
    for dx in -1..=1 {
        for dy in -1..=1 {
            for dz in -1..=1 {
                if let Some(v) = grid.get(&(cx + dx, cy + dy, cz + dz)) {
                    out.extend_from_slice(v);
                }
            }
        }
    }
    out
}

/// Distância ao quadrado de um ponto ao SEGMENTO `a`-`b`.
///
/// É o que permite detectar acerto ao longo do caminho do projétil em
/// vez de só na posição final — sem isso, projéteis rápidos atravessam
/// alvos entre um tick e outro.
/// Aparência de um projétil para o cliente.
///
/// Extraída porque os dois construtores de snapshot (o dinâmico com AOI
/// e o completo) precisam produzir exatamente o mesmo payload — se
/// divergirem, o mesmo tiro muda de cara conforme o jogador está perto
/// ou longe.
fn projectile_payload(p: &Projectile) -> ProjectilePayload {
    ProjectilePayload {
        visual: p.visual,
        charge: p.charge,
        radius: p.radius,
    }
}

fn point_segment_dist_sq(p: Position, a: Position, b: Position) -> f32 {
    let abx = b.x - a.x;
    let aby = b.y - a.y;
    let abz = b.z - a.z;
    let len_sq = abx * abx + aby * aby + abz * abz;
    if len_sq <= f32::EPSILON {
        return dist_sq(p, a);
    }
    // Projeção de `ap` sobre `ab`, limitada ao trecho [0,1].
    let apx = p.x - a.x;
    let apy = p.y - a.y;
    let apz = p.z - a.z;
    let t = ((apx * abx + apy * aby + apz * abz) / len_sq).clamp(0.0, 1.0);
    let cx = a.x + abx * t;
    let cy = a.y + aby * t;
    let cz = a.z + abz * t;
    let dx = p.x - cx;
    let dy = p.y - cy;
    let dz = p.z - cz;
    dx * dx + dy * dy + dz * dz
}

/// Distância ao quadrado (evita a raiz quadrada no caminho quente).
pub fn dist_sq(a: Position, b: Position) -> f32 {
    let dx = a.x - b.x;
    let dy = a.y - b.y;
    let dz = a.z - b.z;
    dx * dx + dy * dy + dz * dz
}

/// Entidades DINÂMICAS (naves, projéteis, NPCs) dentro do raio de
/// interesse de `center`. É o que vai no snapshot de 20Hz.
///
/// Antes o snapshot carregava o mundo inteiro para todo mundo; com AOI o
/// custo por jogador passa a depender da vizinhança dele, não do tamanho
/// do setor.
pub fn build_dynamic_snapshot(
    world: &World,
    center: Position,
    radius: f32,
) -> Vec<crate::net::protocol::EntityState> {
    use crate::net::protocol::EntityState;
    use crate::npc::build_npc_payload;

    let r2 = radius * radius;
    let mut entities = Vec::new();

    let mut ship_ids: Vec<_> = world.ships.keys().copied().collect();
    ship_ids.sort();
    for id in ship_ids {
        let (p, v, r, s) = &world.ships[&id];
        if dist_sq(*p, center) > r2 {
            continue;
        }
        entities.push(EntityState {
            id,
            kind: EntityKind::Ship,
            pos: [p.x, p.y, p.z],
            rot: [r.x, r.y, r.z, r.w],
            vel: [v.x, v.y, v.z],
            hp_ratio: Some(s.hull_hp / s.hull_max),
            display_name: Some(s.name.clone()),
            payload: None,
        });
    }

    let mut proj_ids: Vec<_> = world.projectiles.keys().copied().collect();
    proj_ids.sort();
    for id in proj_ids {
        let (p, v, pr) = &world.projectiles[&id];
        if dist_sq(*p, center) > r2 {
            continue;
        }
        entities.push(EntityState {
            id,
            kind: EntityKind::Projectile,
            pos: [p.x, p.y, p.z],
            rot: [0.0, 0.0, 0.0, 1.0],
            vel: [v.x, v.y, v.z],
            hp_ratio: None,
            display_name: None,
            payload: Some(EntityPayload::Projectile(projectile_payload(pr))),
        });
    }


    let mut torp_ids: Vec<_> = world.torpedoes.keys().copied().collect();
    torp_ids.sort();
    for id in torp_ids {
        let (p, t) = &world.torpedoes[&id];
        entities.push(EntityState {
            id,
            kind: EntityKind::Torpedo,
            pos: [p.x, p.y, p.z],
            rot: [0.0, 0.0, 0.0, 1.0],
            vel: [
                t.dir[0] * t.speed,
                t.dir[1] * t.speed,
                t.dir[2] * t.speed,
            ],
            hp_ratio: None,
            display_name: None,
            payload: Some(EntityPayload::Torpedo(TorpedoPayload {
                dir: t.dir,
                radius: t.profile.radius,
                hp_ratio: (t.hp / t.profile.hp).clamp(0.0, 1.0),
                locked: t.target.is_some(),
            })),
        });
    }
    let mut npc_ids: Vec<_> = world.npcs.keys().copied().collect();
    npc_ids.sort();
    for id in npc_ids {
        let (p, v) = world
            .npc_positions
            .get(&id)
            .copied()
            .unwrap_or((Position::default(), Velocity::default()));
        if dist_sq(p, center) > r2 {
            continue;
        }
        let npc = &world.npcs[&id];
        entities.push(EntityState {
            id,
            kind: EntityKind::Npc,
            pos: [p.x, p.y, p.z],
            rot: [0.0, 0.0, 0.0, 1.0],
            vel: [v.x, v.y, v.z],
            hp_ratio: Some(npc.hp_ratio()),
            display_name: Some(format!("{:?}", npc.kind)),
            payload: Some(build_npc_payload(npc)),
        });
    }

    // Vortices de dobra. Vao pelo canal DINAMICO (e nao por
    // `WorldChunk`) porque expiram em segundos: mante-los no fluxo de
    // estaticos exigiria um evento de remocao para cada um.
    for (id, v) in &world.vortices {
        if dist_sq(
            Position { x: v.pos[0], y: v.pos[1], z: v.pos[2] },
            center,
        ) > r2
        {
            continue;
        }
        entities.push(EntityState {
            id: *id,
            kind: EntityKind::Vortex,
            pos: v.pos,
            rot: [0.0, 0.0, 0.0, 1.0],
            vel: [0.0, 0.0, 0.0],
            hp_ratio: None,
            display_name: None,
            payload: Some(crate::net::protocol::EntityPayload::Vortex(
                crate::net::protocol::VortexPayload {
                    dir: v.dir,
                    radius: v.radius,
                    strength: v.strength(),
                },
            )),
        });
    }

    entities
}

/// Entidades ESTÁTICAS dentro do raio (asteroides, anomalias, destroços).
///
/// Elas não se movem. O servidor manda cada uma UMA vez, quando entra no
/// raio do jogador, e avisa quando sai — em vez de reenviar tudo 20x por
/// segundo, que era o grosso da banda desperdiçada.
pub fn static_entities_near(
    world: &World,
    center: Position,
    radius: f32,
) -> Vec<crate::net::protocol::EntityState> {
    use crate::net::protocol::{
        AnomalyPayload, AsteroidPayload, EntityPayload, EntityState, WreckPayload,
    };
    let r2 = radius * radius;
    let mut out = Vec::new();

    let mut ast_ids: Vec<_> = world.asteroids.keys().copied().collect();
    ast_ids.sort();
    for id in ast_ids {
        let (p, a) = &world.asteroids[&id];
        if dist_sq(*p, center) > r2 {
            continue;
        }
        out.push(EntityState {
            id,
            kind: EntityKind::Asteroid,
            pos: [p.x, p.y, p.z],
            rot: [0.0, 0.0, 0.0, 1.0],
            vel: [0.0, 0.0, 0.0],
            hp_ratio: None,
            display_name: None,
            payload: Some(EntityPayload::Asteroid(AsteroidPayload {
                kind: a.kind,
                radius: a.radius,
                resource_units: a.resource_units,
            })),
        });
    }

    let mut ano_ids: Vec<_> = world.anomalies.keys().copied().collect();
    ano_ids.sort();
    for id in ano_ids {
        let (p, a) = &world.anomalies[&id];
        if dist_sq(*p, center) > r2 {
            continue;
        }
        out.push(EntityState {
            id,
            kind: EntityKind::Anomaly,
            pos: [p.x, p.y, p.z],
            rot: [0.0, 0.0, 0.0, 1.0],
            vel: [0.0, 0.0, 0.0],
            hp_ratio: None,
            display_name: None,
            payload: Some(EntityPayload::Anomaly(AnomalyPayload {
                kind: a.kind,
                radius: a.radius,
                intensity: a.intensity,
                target_warp_id: a.target_warp_id,
            })),
        });
    }

    let mut wreck_ids: Vec<_> = world.wrecks.keys().copied().collect();
    wreck_ids.sort();
    for id in wreck_ids {
        let (p, w) = &world.wrecks[&id];
        if dist_sq(*p, center) > r2 {
            continue;
        }
        out.push(EntityState {
            id,
            kind: EntityKind::Wreck,
            pos: [p.x, p.y, p.z],
            rot: [0.0, 0.0, 0.0, 1.0],
            vel: [0.0, 0.0, 0.0],
            hp_ratio: None,
            display_name: None,
            payload: Some(EntityPayload::Wreck(WreckPayload {
                ship_template: w.ship_template.clone(),
                radius: w.radius,
                ttl_remaining: w.ttl_remaining,
                loot_count: w.loot_count,
            })),
        });
    }

    out
}

/// Gera o snapshot completo (mundo inteiro) para os clientes.
///
/// Mantido para os testes de determinismo e para ferramentas offline — o
/// caminho de rede usa `build_dynamic_snapshot` + `static_entities_near`,
/// que filtram por raio de interesse. O binário não o chama, daí o allow.
#[allow(dead_code)]
pub fn build_snapshot(world: &World) -> crate::net::protocol::SnapshotData {
    use crate::net::protocol::{
        AnomalyPayload, AsteroidPayload, EntityPayload, EntityState, SnapshotData, WreckPayload,
    };
    use crate::npc::build_npc_payload;
    let mut entities = Vec::with_capacity(
        world.ships.len()
            + world.projectiles.len()
            + world.npcs.len()
            + world.asteroids.len()
            + world.anomalies.len()
            + world.wrecks.len(),
    );

    let mut ship_ids: Vec<_> = world.ships.keys().copied().collect();
    ship_ids.sort();
    for id in ship_ids {
        let (p, v, r, s) = &world.ships[&id];
        entities.push(EntityState {
            id,
            kind: EntityKind::Ship,
            pos: [p.x, p.y, p.z],
            rot: [r.x, r.y, r.z, r.w],
            vel: [v.x, v.y, v.z],
            hp_ratio: Some(s.hull_hp / s.hull_max),
            display_name: Some(s.name.clone()),
            payload: None,
        });
    }

    let mut proj_ids: Vec<_> = world.projectiles.keys().copied().collect();
    proj_ids.sort();
    for id in proj_ids {
        let (p, v, pr) = &world.projectiles[&id];
        entities.push(EntityState {
            id,
            kind: EntityKind::Projectile,
            pos: [p.x, p.y, p.z],
            rot: [0.0, 0.0, 0.0, 1.0],
            vel: [v.x, v.y, v.z],
            hp_ratio: None,
            display_name: None,
            payload: Some(EntityPayload::Projectile(projectile_payload(pr))),
        });
    }


    let mut torp_ids: Vec<_> = world.torpedoes.keys().copied().collect();
    torp_ids.sort();
    for id in torp_ids {
        let (p, t) = &world.torpedoes[&id];
        entities.push(EntityState {
            id,
            kind: EntityKind::Torpedo,
            pos: [p.x, p.y, p.z],
            rot: [0.0, 0.0, 0.0, 1.0],
            vel: [
                t.dir[0] * t.speed,
                t.dir[1] * t.speed,
                t.dir[2] * t.speed,
            ],
            hp_ratio: None,
            display_name: None,
            payload: Some(EntityPayload::Torpedo(TorpedoPayload {
                dir: t.dir,
                radius: t.profile.radius,
                hp_ratio: (t.hp / t.profile.hp).clamp(0.0, 1.0),
                locked: t.target.is_some(),
            })),
        });
    }
    // NPCs.
    let mut npc_ids: Vec<_> = world.npcs.keys().copied().collect();
    npc_ids.sort();
    for id in npc_ids {
        let npc = &world.npcs[&id];
        let (p, v) = world
            .npc_positions
            .get(&id)
            .copied()
            .unwrap_or((Position::default(), Velocity::default()));
        entities.push(EntityState {
            id,
            kind: EntityKind::Npc,
            pos: [p.x, p.y, p.z],
            rot: [0.0, 0.0, 0.0, 1.0],
            vel: [v.x, v.y, v.z],
            hp_ratio: Some(npc.hp_ratio()),
            display_name: Some(format!("{:?}", npc.kind)),
            payload: Some(build_npc_payload(npc)),
        });
    }

    // Asteroides.
    let mut ast_ids: Vec<_> = world.asteroids.keys().copied().collect();
    ast_ids.sort();
    for id in ast_ids {
        let (p, a) = &world.asteroids[&id];
        entities.push(EntityState {
            id,
            kind: EntityKind::Asteroid,
            pos: [p.x, p.y, p.z],
            rot: [0.0, 0.0, 0.0, 1.0],
            vel: [0.0, 0.0, 0.0],
            hp_ratio: None,
            display_name: None,
            payload: Some(EntityPayload::Asteroid(AsteroidPayload {
                kind: a.kind,
                radius: a.radius,
                resource_units: a.resource_units,
            })),
        });
    }

    // Anomalias.
    let mut anom_ids: Vec<_> = world.anomalies.keys().copied().collect();
    anom_ids.sort();
    for id in anom_ids {
        let (p, a) = &world.anomalies[&id];
        entities.push(EntityState {
            id,
            kind: EntityKind::Anomaly,
            pos: [p.x, p.y, p.z],
            rot: [0.0, 0.0, 0.0, 1.0],
            vel: [0.0, 0.0, 0.0],
            hp_ratio: None,
            display_name: None,
            payload: Some(EntityPayload::Anomaly(AnomalyPayload {
                kind: a.kind,
                radius: a.radius,
                intensity: a.intensity,
                target_warp_id: a.target_warp_id,
            })),
        });
    }

    // Wrecks.
    let mut wreck_ids: Vec<_> = world.wrecks.keys().copied().collect();
    wreck_ids.sort();
    for id in wreck_ids {
        let (p, w) = &world.wrecks[&id];
        entities.push(EntityState {
            id,
            kind: EntityKind::Wreck,
            pos: [p.x, p.y, p.z],
            rot: [0.0, 0.0, 0.0, 1.0],
            vel: [0.0, 0.0, 0.0],
            hp_ratio: None,
            display_name: Some(w.ship_template.clone()),
            payload: Some(EntityPayload::Wreck(WreckPayload {
                ship_template: w.ship_template.clone(),
                radius: w.radius,
                ttl_remaining: w.ttl_remaining,
                loot_count: w.loot_count,
            })),
        });
    }

    SnapshotData {
        tick: world.tick,
        server_time_ms: (world.elapsed * 1000.0) as u64,
        entities,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_ship(w: &mut World, name: &str) -> EntityId {
        w.spawn_player_ship(0, name.into())
    }

    #[test]
    fn step_advances_tick() {
        let mut w = World::new();
        assert_eq!(w.tick, 0);
        w.step(1.0 / 30.0);
        assert_eq!(w.tick, 1);
    }

    #[test]
    fn thrust_moves_ship() {
        let mut w = World::new();
        let id = make_ship(&mut w, "alpha");
        let (_, _, _, ship) = w.ships.get(&id).unwrap();
        let mut ship = ship.clone();
        ship.thrust_input = 1.0;
        w.ships.get_mut(&id).unwrap().3 = ship;
        for _ in 0..30 { w.step(1.0/30.0); }
        let (p, _, _, _) = w.ships[&id];
        assert!(p.z > 0.0, "esperado movimento +Z, got p={p:?}");
    }

    #[test]
    fn determinism_two_runs_match() {
        fn run() -> u64 {
            let mut w = World::new();
            let id = make_ship(&mut w, "alpha");
            let mut ship = w.ships[&id].3.clone();
            ship.thrust_input = 0.5;
            ship.steer_input = 0.3;
            w.ships.get_mut(&id).unwrap().3 = ship;
            for _ in 0..60 { w.step(1.0/30.0); }
            w.state_hash()
        }
        let a = run();
        let b = run();
        assert_eq!(a, b, "state hash divergente: {a} vs {b}");
    }

    #[test]
    fn snapshot_contains_all_ships() {
        let mut w = World::new();
        make_ship(&mut w, "alpha");
        make_ship(&mut w, "bravo");
        let snap = build_snapshot(&w);
        assert_eq!(snap.entities.len(), 2);
    }

    #[test]
    fn steer_input_rotates_ship() {
        let mut w = World::new();
        let id = make_ship(&mut w, "alpha");
        let mut ship = w.ships[&id].3.clone();
        ship.steer_input = 1.0;
        ship.thrust_input = 0.0;
        w.ships.get_mut(&id).unwrap().3 = ship;
        let initial_y = w.ships[&id].2.y;
        for _ in 0..30 { w.step(1.0/30.0); }
        let after_y = w.ships[&id].2.y;
        assert!((after_y - initial_y).abs() > 0.1, "esperado yaw, got dy={}", after_y - initial_y);
    }

    #[test]
    fn step_decrements_fire_cooldown() {
        let mut w = World::new();
        let id = make_ship(&mut w, "alpha");
        w.ships.get_mut(&id).unwrap().3.fire_cooldown = 0.5;
        w.step(1.0/30.0);
        assert!(w.ships[&id].3.fire_cooldown < 0.5);
    }

    #[test]
    fn firing_spawns_projectile() {
        let mut w = World::new();
        let id = make_ship(&mut w, "alpha");
        w.ships.get_mut(&id).unwrap().3.pending_fire = true;
        w.step(1.0/30.0);
        assert_eq!(w.projectiles.len(), 1, "esperado 1 projétil");
        let (_p, vel, _proj) = w.projectiles.values().next().unwrap();
        // forward do quaternion identity = (0, 0, 1) → velocidade em +Z.
        assert!(vel.z > 0.0, "esperado vel.z > 0, got {vel:?}");
    }

    #[test]
    fn fire_respects_cooldown() {
        let mut w = World::new();
        let id = make_ship(&mut w, "alpha");
        w.ships.get_mut(&id).unwrap().3.pending_fire = true;
        w.step(1.0/30.0);
        assert_eq!(w.projectiles.len(), 1);
        // Tenta disparar de novo sem esperar cooldown.
        w.ships.get_mut(&id).unwrap().3.pending_fire = true;
        w.step(1.0/30.0);
        assert_eq!(w.projectiles.len(), 1, "cooldown deveria bloquear 2º tiro");
    }

    #[test]
    fn projectile_damages_ship_on_collision() {
        let mut w = World::new();
        let attacker = w.spawn_player_ship(1, "atk".into());
        let target = w.spawn_player_ship(2, "tgt".into());
        // Atirador em z=0, alvo em z=10 (10m à frente).
        w.ships.get_mut(&target).unwrap().0 = Position { x: 0.0, y: 0.0, z: 10.0 };
        w.ships.get_mut(&attacker).unwrap().0 = Position { x: 0.0, y: 0.0, z: 0.0 };
        w.ships.get_mut(&attacker).unwrap().3.pending_fire = true;
        // Sem escudo, o dano vai direto ao casco.
        w.ships.get_mut(&target).unwrap().3.shield_hp = 0.0;
        // Avança ticks até o projétil chegar ao alvo (~10/100=0.1s = 3 ticks).
        for _ in 0..5 { w.step(1.0/30.0); }
        let hp = w.ships[&target].3.hull_hp;
        assert!(hp < 100.0, "esperado dano, hp={hp}");
    }

    #[test]
    fn projetil_atravessa_o_proprio_atirador() {
        // Regressão: naves nascem na origem, então o projétil colidia
        // com a própria nave e era consumido sem atingir ninguém.
        let mut w = World::new();
        let attacker = w.spawn_player_ship(1, "atk".into());
        let target = w.spawn_player_ship(2, "tgt".into());
        // Ambos exatamente na origem, como no spawn real.
        w.ships.get_mut(&attacker).unwrap().0 = Position::default();
        w.ships.get_mut(&target).unwrap().0 = Position::default();
        w.ships.get_mut(&target).unwrap().3.shield_hp = 0.0;
        w.ships.get_mut(&target).unwrap().3.shield_regen = 0.0;
        let antes = w.ships[&target].3.hull_hp;

        w.ships.get_mut(&attacker).unwrap().3.pending_fire = true;
        for _ in 0..5 {
            w.step(1.0 / 30.0);
        }

        let depois = w.ships.get(&target).map(|s| s.3.hull_hp).unwrap_or(0.0);
        assert!(depois < antes, "o alvo sobreposto deveria levar dano: {antes} -> {depois}");
        // E o atirador não pode ter se ferido.
        assert_eq!(w.ships[&attacker].3.hull_hp, w.ships[&attacker].3.hull_max);
    }

    #[test]
    fn gravidade_puxa_nave_parada() {
        let mut w = World::new();
        let id = w.spawn_player_ship(1, "queda".into());
        // Coloca a nave logo acima da superfície de um planeta.
        let corpo = w
            .bodies
            .iter()
            .find(|b| b.kind != sim_core::worldgen::celestial::BodyKind::Star)
            .expect("setor tem planeta")
            .clone();
        w.ships.get_mut(&id).unwrap().0 = Position {
            x: corpo.pos[0] + corpo.radius * 2.5,
            y: corpo.pos[1],
            z: corpo.pos[2],
        };
        // Sem empuxo: só a gravidade age.
        w.set_input(1, 0.0, 0.0, 0.0, 0.0, false, 0.0, None, None);
        for _ in 0..30 {
            w.step(1.0 / 30.0);
        }

        let (p, v, _, _) = &w.ships[&id];
        let vel = (v.x * v.x + v.y * v.y + v.z * v.z).sqrt();
        assert!(vel > 1.0, "a nave deveria estar caindo, vel={vel}");
        // E caindo NA DIREÇÃO do corpo.
        let para_corpo = [corpo.pos[0] - p.x, corpo.pos[1] - p.y, corpo.pos[2] - p.z];
        let dot = para_corpo[0] * v.x + para_corpo[1] * v.y + para_corpo[2] * v.z;
        assert!(dot > 0.0, "a velocidade deveria apontar para o corpo");
    }

    /// Vetor de frente da nave do jogador 1.
    fn frente(w: &World) -> [f32; 3] {
        let id = w.player_ships[&1];
        forward(&w.ships[&id].2)
    }

    #[test]
    fn diagnostico_dos_eixos_de_controle() {
        // Convenções: frente = +Z. Com a câmera ATRÁS (olhando ao longo
        // de +Z) e +Y para cima, a DIREITA da tela é -X
        // (right = forward x up = (0,0,1)x(0,1,0) = (-1,0,0)).
        //
        // Portanto, para o controle não parecer invertido:
        //   pitch = +1 (tecla W)  -> frente.y AUMENTA (nariz sobe)
        //   steer = +1 (tecla D)  -> frente.x DIMINUI (nariz vai à direita)

        // --- pitch ---
        let mut w = World::new();
        w.spawn_player_ship(1, "p".into());
        w.set_input(1, 0.0, 1.0, 0.0, 0.0, false, 0.0, None, None);
        for _ in 0..10 { w.step(1.0 / 30.0); }
        let f = frente(&w);
        assert!(f[1] > 0.05, "W deveria levantar o nariz, frente={f:?}");

        // --- yaw ---
        let mut w = World::new();
        w.spawn_player_ship(1, "p".into());
        w.set_input(1, 1.0, 0.0, 0.0, 0.0, false, 0.0, None, None);
        for _ in 0..10 { w.step(1.0 / 30.0); }
        let f = frente(&w);
        assert!(f[0] < -0.05, "D deveria virar para a direita da tela (-X), frente={f:?}");
    }

    /// Ativa a dobra da nave do jogador `pid`.
    fn dobrar(w: &mut World, pid: u32) {
        let id = w.player_ships[&pid];
        w.ships.get_mut(&id).unwrap().3.skills.unlock(ActiveSkill::Dash);
        w.set_input(pid, 0.0, 0.0, 0.0, 1.0, false, 0.0, Some(ActiveSkill::Dash), None);
    }

    #[test]
    fn dobra_acelera_muito_mais_que_empuxo_normal() {
        // Mede DESLOCAMENTO a partir do ponto de surgimento: as naves
        // nascem espalhadas num anel, então distância à origem não diz
        // nada sobre o quanto elas andaram.
        let percorrido = |dobrando: bool| -> f32 {
            let mut w = World::new();
            w.spawn_player_ship(1, "p".into());
            let inicio = w.player_position(1).unwrap();
            if dobrando {
                dobrar(&mut w, 1);
            } else {
                w.set_input(1, 0.0, 0.0, 0.0, 1.0, false, 0.0, None, None);
            }
            for _ in 0..30 { w.step(1.0 / 30.0); }
            let fim = w.player_position(1).unwrap();
            ((fim.x - inicio.x).powi(2) + (fim.y - inicio.y).powi(2) + (fim.z - inicio.z).powi(2))
                .sqrt()
        };
        let normal = percorrido(false);
        let dobra = percorrido(true);
        assert!(dobra > normal * 3.0, "dobra={dobra} normal={normal}");
    }

    #[test]
    fn dobra_deixa_rastro_de_vortices() {
        let mut w = World::new();
        w.spawn_player_ship(1, "d".into());
        dobrar(&mut w, 1);
        for _ in 0..30 { w.step(1.0 / 30.0); }
        assert!(!w.vortices.is_empty(), "a dobra deveria ter deixado rastro");
    }

    #[test]
    fn outra_nave_ganha_impulso_do_rastro() {
        // O ponto da mecânica: quem persegue aproveita o rastro de quem
        // foge. Sem isto o vórtice seria só decoração.
        let mut w = World::new();
        w.spawn_player_ship(1, "fujao".into());
        let perseguidor = w.spawn_player_ship(2, "cacador".into());

        dobrar(&mut w, 1);
        for _ in 0..10 { w.step(1.0 / 30.0); }
        assert!(!w.vortices.is_empty());

        // Coloca o perseguidor exatamente sobre um vórtice, parado.
        let v = w.vortices[0].1;
        if let Some((p, vel, _, _)) = w.ships.get_mut(&perseguidor) {
            p.x = v.pos[0];
            p.y = v.pos[1];
            p.z = v.pos[2];
            vel.x = 0.0;
            vel.y = 0.0;
            vel.z = 0.0;
        }
        w.set_input(2, 0.0, 0.0, 0.0, 0.0, false, 0.0, None, None);
        for _ in 0..5 { w.step(1.0 / 30.0); }

        let (_, vel, _, _) = &w.ships[&perseguidor];
        let v2 = (vel.x * vel.x + vel.y * vel.y + vel.z * vel.z).sqrt();
        assert!(v2 > 1.0, "o perseguidor deveria ter sido impulsionado, vel={v2}");
    }

    #[test]
    fn nave_em_dobra_atravessa_corpos_celestes() {
        // O salto ignora obstáculos: é o que o torna útil para ir de um
        // ponto a outro.
        let mut w = World::new();
        let corpo = w.bodies[0].clone();
        let id = w.spawn_player_ship(1, "d".into());
        // Dentro da superfície do corpo — colisão certa sem a imunidade.
        if let Some((p, _, _, _)) = w.ships.get_mut(&id) {
            p.x = corpo.pos[0];
            p.y = corpo.pos[1];
            p.z = corpo.pos[2];
        }
        dobrar(&mut w, 1);
        w.step(1.0 / 30.0);
        assert!(w.ships.contains_key(&id), "em dobra a nave não deveria colidir");
    }

    #[test]
    fn nave_em_dobra_nao_e_alvo_de_projetil() {
        let mut w = World::new();
        let atirador = w.spawn_player_ship(1, "atk".into());
        let alvo = w.spawn_player_ship(2, "alvo".into());
        w.ships.get_mut(&atirador).unwrap().0 = Position { x: 0.0, y: 0.0, z: 0.0 };
        w.ships.get_mut(&alvo).unwrap().0 = Position { x: 0.0, y: 0.0, z: 10.0 };
        w.ships.get_mut(&alvo).unwrap().3.shield_hp = 0.0;
        let hp = w.ships[&alvo].3.hull_hp;

        dobrar(&mut w, 2);
        w.ships.get_mut(&atirador).unwrap().3.pending_fire = true;
        for _ in 0..5 { w.step(1.0 / 30.0); }

        if let Some((_, _, _, s)) = w.ships.get(&alvo) {
            assert_eq!(s.hull_hp, hp, "nave em dobra não pode levar dano");
        }
    }

    #[test]
    fn tiro_carregado_causa_mais_dano_que_toque() {
        let disparar = |carga: f32| -> f32 {
            let mut w = World::new();
            let atk = w.spawn_player_ship(1, "a".into());
            let alvo = w.spawn_player_ship(2, "b".into());
            w.apply_loadout(1, &["plasma_m".to_string()]);
            // Posiciona AS DUAS naves: elas nascem espalhadas num anel,
            // então não dá para assumir que o atirador está na origem.
            w.ships.get_mut(&atk).unwrap().0 = Position { x: 0.0, y: 0.0, z: 0.0 };
            w.ships.get_mut(&alvo).unwrap().0 = Position { x: 0.0, y: 0.0, z: 10.0 };
            w.ships.get_mut(&alvo).unwrap().3.shield_hp = 0.0;
            w.ships.get_mut(&alvo).unwrap().3.hull_max = 100000.0;
            w.ships.get_mut(&alvo).unwrap().3.hull_hp = 100000.0;
            let antes = w.ships[&alvo].3.hull_hp;
            w.set_input(1, 0.0, 0.0, 0.0, 0.0, true, carga, None, None);
            for _ in 0..8 { w.step(1.0 / 30.0); }
            antes - w.ships.get(&alvo).map(|s| s.3.hull_hp).unwrap_or(0.0)
        };
        let toque = disparar(0.0);
        let cheio = disparar(2.0);
        assert!(toque > 0.0, "o toque deveria causar algum dano");
        assert!(cheio > toque * 2.0, "toque={toque} cheio={cheio}");
    }

    #[test]
    fn projetil_encurva_perto_de_corpo() {
        // Regressão: a gravidade valia só para naves, e os tiros
        // atravessavam poços gravitacionais em linha reta.
        let mut w = World::new();
        let corpo = w
            .bodies
            .iter()
            .find(|b| b.kind != sim_core::worldgen::celestial::BodyKind::Star)
            .expect("setor tem planeta")
            .clone();

        let id = w.spawn_player_ship(1, "atirador".into());
        // Ao lado do corpo, atirando paralelamente à superfície.
        w.ships.get_mut(&id).unwrap().0 = Position {
            x: corpo.pos[0] + corpo.radius * 2.0,
            y: corpo.pos[1],
            z: corpo.pos[2] - 400.0,
        };
        w.ships.get_mut(&id).unwrap().3.pending_fire = true;
        w.step(1.0 / 30.0);

        let (_, v0, _) = w.projectiles.values().next().expect("projétil criado").clone();
        for _ in 0..20 {
            w.step(1.0 / 30.0);
        }
        // O projétil pode ter sido consumido; se sobreviveu, a
        // velocidade tem de ter ganhado componente na direção do corpo.
        if let Some((_, v1, _)) = w.projectiles.values().next() {
            assert!(
                (v1.x - v0.x).abs() > 1e-3 || (v1.y - v0.y).abs() > 1e-3,
                "a velocidade deveria ter mudado pela gravidade: {v0:?} -> {v1:?}"
            );
        }
    }

    #[test]
    fn estrela_queima_quem_se_aproxima() {
        let mut w = World::new();
        let estrela = w
            .bodies
            .iter()
            .find(|b| b.kind == sim_core::worldgen::celestial::BodyKind::Star)
            .expect("setor tem estrela")
            .clone();
        let id = w.spawn_player_ship(1, "assado".into());
        // Dentro do raio de captura, fora da superfície.
        w.ships.get_mut(&id).unwrap().0 = Position {
            x: estrela.pos[0] + estrela.radius * 2.0,
            y: estrela.pos[1],
            z: estrela.pos[2],
        };
        let antes = w.ships[&id].3.hull_hp;
        for _ in 0..30 {
            w.step(1.0 / 30.0);
        }
        let depois = w.ships.get(&id).map(|s| s.3.hull_hp).unwrap_or(0.0);
        assert!(depois < antes, "a estrela deveria causar dano: {antes} -> {depois}");
    }

    #[test]
    fn planeta_comum_nao_queima() {
        let mut w = World::new();
        let planeta = w
            .bodies
            .iter()
            .find(|b| b.kind == sim_core::worldgen::celestial::BodyKind::Planet)
            .expect("setor tem planeta")
            .clone();
        let id = w.spawn_player_ship(1, "ok".into());
        w.ships.get_mut(&id).unwrap().0 = Position {
            x: planeta.pos[0] + planeta.radius * 3.0,
            y: planeta.pos[1],
            z: planeta.pos[2],
        };
        let antes = w.ships[&id].3.hull_hp;
        // Poucos ticks: tempo insuficiente para colidir, mas suficiente
        // para o calor agir, se houvesse.
        for _ in 0..5 {
            w.step(1.0 / 30.0);
        }
        let depois = w.ships.get(&id).map(|s| s.3.hull_hp).unwrap_or(0.0);
        assert_eq!(depois, antes, "planeta comum não deveria causar dano térmico");
    }

    #[test]
    fn colisao_com_planeta_destroi_a_nave() {
        let mut w = World::new();
        let id = w.spawn_player_ship(1, "impacto".into());
        let corpo = w
            .bodies
            .iter()
            .find(|b| b.kind != sim_core::worldgen::celestial::BodyKind::Star)
            .expect("setor tem planeta")
            .clone();
        // Dentro da superfície.
        w.ships.get_mut(&id).unwrap().0 = Position {
            x: corpo.pos[0],
            y: corpo.pos[1],
            z: corpo.pos[2],
        };
        w.step(1.0 / 30.0);
        assert!(!w.ships.contains_key(&id), "colidir com planeta tem de destruir a nave");
    }

    #[test]
    fn escudo_absorve_antes_do_casco() {
        // Regressão: o dano ia direto ao casco e os escudos vendidos na
        // loja não tinham efeito nenhum.
        let mut w = World::new();
        let attacker = w.spawn_player_ship(1, "atk".into());
        let target = w.spawn_player_ship(2, "tgt".into());
        w.ships.get_mut(&target).unwrap().0 = Position { x: 0.0, y: 0.0, z: 10.0 };
        w.ships.get_mut(&attacker).unwrap().0 = Position { x: 0.0, y: 0.0, z: 0.0 };
        // Escudo folgado: absorve o disparo inteiro.
        w.ships.get_mut(&target).unwrap().3.shield_hp = 500.0;
        w.ships.get_mut(&target).unwrap().3.shield_max = 500.0;
        w.ships.get_mut(&target).unwrap().3.shield_regen = 0.0;
        let casco_antes = w.ships[&target].3.hull_hp;

        w.ships.get_mut(&attacker).unwrap().3.pending_fire = true;
        for _ in 0..5 { w.step(1.0/30.0); }

        let alvo = &w.ships[&target].3;
        assert!(alvo.shield_hp < 500.0, "o escudo deveria ter absorvido");
        assert_eq!(alvo.hull_hp, casco_antes, "o casco não podia ser tocado");
    }

    #[test]
    fn excedente_passa_do_escudo_para_o_casco() {
        let mut w = World::new();
        let attacker = w.spawn_player_ship(1, "atk".into());
        let target = w.spawn_player_ship(2, "tgt".into());
        w.ships.get_mut(&target).unwrap().0 = Position { x: 0.0, y: 0.0, z: 10.0 };
        w.ships.get_mut(&attacker).unwrap().0 = Position { x: 0.0, y: 0.0, z: 0.0 };
        // Escudo quase vazio: parte do dano vaza para o casco.
        w.ships.get_mut(&target).unwrap().3.shield_hp = 2.0;
        w.ships.get_mut(&target).unwrap().3.shield_regen = 0.0;
        let casco_antes = w.ships[&target].3.hull_hp;

        w.ships.get_mut(&attacker).unwrap().3.pending_fire = true;
        for _ in 0..5 { w.step(1.0/30.0); }

        let alvo = &w.ships[&target].3;
        assert_eq!(alvo.shield_hp, 0.0, "escudo deveria zerar");
        assert!(alvo.hull_hp < casco_antes, "o excedente tinha de atingir o casco");
    }

    #[test]
    fn ship_destroyed_when_hp_zero() {
        let mut w = World::new();
        let attacker = w.spawn_player_ship(1, "atk".into());
        let target = w.spawn_player_ship(2, "tgt".into());
        w.ships.get_mut(&target).unwrap().0 = Position { x: 0.0, y: 0.0, z: 10.0 };
        w.ships.get_mut(&attacker).unwrap().0 = Position { x: 0.0, y: 0.0, z: 0.0 };
        // HP do alvo = 1 hit de kill (damage default 10).
        w.ships.get_mut(&target).unwrap().3.hull_hp = 5.0;
        w.ships.get_mut(&target).unwrap().3.shield_hp = 0.0;
        w.ships.get_mut(&attacker).unwrap().3.pending_fire = true;
        for _ in 0..5 { w.step(1.0/30.0); }
        let destroyed = w.take_destroyed();
        assert!(destroyed.contains(&(target, Some(1))), "target deveria estar destruído: {destroyed:?}");
        assert!(!w.ships.contains_key(&target));
    }

    #[test]
    fn projectile_expires_by_ttl() {
        let mut w = World::new();
        let id = w.spawn_player_ship(1, "x".into());
        w.ships.get_mut(&id).unwrap().3.pending_fire = true;
        w.step(1.0/30.0);
        assert_eq!(w.projectiles.len(), 1);
        // Avança muito tempo para TTL expirar.
        for _ in 0..200 { w.step(1.0/30.0); }
        assert_eq!(w.projectiles.len(), 0, "projétil deveria ter expirado");
        let destroyed = w.take_destroyed();
        assert!(
            !destroyed.is_empty(),
            "projétil expirado deveria estar em destroyed"
        );
    }

    // ---------- Task 6.2: Party System ----------

    #[test]
    fn projectile_no_damage_to_party_member() {
        let mut w = World::new();
        
        // Simula criação de party entre player 1 e player 2
        w.set_party(1, 100);
        w.set_party(2, 100);

        let attacker = w.spawn_player_ship(1, "atk".into());
        let target = w.spawn_player_ship(2, "tgt".into());
        
        // Atirador em z=0, alvo em z=10 (10m à frente).
        w.ships.get_mut(&target).unwrap().0 = Position { x: 0.0, y: 0.0, z: 10.0 };
        w.ships.get_mut(&attacker).unwrap().0 = Position { x: 0.0, y: 0.0, z: 0.0 };
        w.ships.get_mut(&attacker).unwrap().3.pending_fire = true;
        
        // Avança ticks até o projétil chegar ao alvo
        for _ in 0..5 { w.step(1.0/30.0); }
        
        let hp = w.ships[&target].3.hull_hp;
        assert_eq!(hp, 100.0, "esperado sem dano (friendly fire desativado), hp={}", hp);
    }

    #[test]
    fn ship_destroyed_tracks_killer() {
        let mut w = World::new();
        let attacker = w.spawn_player_ship(1, "atk".into());
        let target = w.spawn_player_ship(2, "tgt".into());
        
        w.ships.get_mut(&target).unwrap().0 = Position { x: 0.0, y: 0.0, z: 10.0 };
        w.ships.get_mut(&attacker).unwrap().0 = Position { x: 0.0, y: 0.0, z: 0.0 };
        w.ships.get_mut(&target).unwrap().3.hull_hp = 5.0; // 1 hit kill
        w.ships.get_mut(&target).unwrap().3.shield_hp = 0.0;
        w.ships.get_mut(&attacker).unwrap().3.pending_fire = true;
        
        for _ in 0..5 { w.step(1.0/30.0); }
        
        let destroyed = w.take_destroyed();
        assert!(destroyed.contains(&(target, Some(1))), "Deveria registrar target destruído pelo player 1");
    }

    // ---------- Task 4.5: NPC / Asteroid / Anomaly / Wreck ----------

    #[test]
    fn spawn_npc_adds_to_world() {
        let mut w = World::new();
        let id = w.spawn_npc(crate::npc::NpcKind::Pirate, Position { x: 1.0, y: 2.0, z: 3.0 });
        assert!(w.npcs.contains_key(&id));
        assert_eq!(w.npc_positions[&id].0, Position { x: 1.0, y: 2.0, z: 3.0 });
        assert_eq!(w.npcs[&id].kind, crate::npc::NpcKind::Pirate);
    }

    #[test]
    fn snapshot_contains_npc() {
        let mut w = World::new();
        w.spawn_npc(crate::npc::NpcKind::Patrol, Position { x: 50.0, y: 0.0, z: 0.0 });
        let snap = build_snapshot(&w);
        let npcs: Vec<_> = snap.entities.iter()
            .filter(|e| matches!(e.kind, EntityKind::Npc))
            .collect();
        assert_eq!(npcs.len(), 1);
        let npc = npcs[0];
        assert!(matches!(npc.payload, Some(crate::net::protocol::EntityPayload::Npc(_))));
    }

    #[test]
    fn snapshot_contains_asteroid() {
        let mut w = World::new();
        w.spawn_asteroid(Position { x: 100.0, y: 0.0, z: 0.0 }, 1, 25.0, 50);
        let snap = build_snapshot(&w);
        let asts: Vec<_> = snap.entities.iter()
            .filter(|e| matches!(e.kind, EntityKind::Asteroid))
            .collect();
        assert_eq!(asts.len(), 1);
        match &asts[0].payload {
            Some(crate::net::protocol::EntityPayload::Asteroid(p)) => {
                assert_eq!(p.kind, 1);
                assert_eq!(p.radius, 25.0);
                assert_eq!(p.resource_units, 50);
            }
            _ => panic!("esperado payload Asteroid"),
        }
    }

    #[test]
    fn snapshot_contains_anomaly() {
        let mut w = World::new();
        w.spawn_anomaly(Position { x: 200.0, y: 0.0, z: 0.0 }, 0, 80.0, 1.0, Some(42));
        let snap = build_snapshot(&w);
        let ans: Vec<_> = snap.entities.iter()
            .filter(|e| matches!(e.kind, EntityKind::Anomaly))
            .collect();
        assert_eq!(ans.len(), 1);
        match &ans[0].payload {
            Some(crate::net::protocol::EntityPayload::Anomaly(p)) => {
                assert_eq!(p.kind, 0);
                assert_eq!(p.target_warp_id, Some(42));
            }
            _ => panic!("esperado payload Anomaly"),
        }
    }

    #[test]
    fn snapshot_contains_wreck() {
        let mut w = World::new();
        w.spawn_wreck(Position::default(), "hauler_light".into(), 12.0, 100, 3);
        let snap = build_snapshot(&w);
        let ws: Vec<_> = snap.entities.iter()
            .filter(|e| matches!(e.kind, EntityKind::Wreck))
            .collect();
        assert_eq!(ws.len(), 1);
        match &ws[0].payload {
            Some(crate::net::protocol::EntityPayload::Wreck(p)) => {
                assert_eq!(p.ship_template, "hauler_light");
                assert_eq!(p.ttl_remaining, 100);
                assert_eq!(p.loot_count, 3);
            }
            _ => panic!("esperado payload Wreck"),
        }
    }

    #[test]
    fn snapshot_mixed_kinds_count() {
        let mut w = World::new();
        w.spawn_player_ship(1, "alpha".into());
        w.spawn_player_ship(2, "bravo".into());
        w.spawn_npc(crate::npc::NpcKind::Pirate, Position { x: 0.0, y: 0.0, z: 0.0 });
        w.spawn_asteroid(Position { x: 100.0, y: 0.0, z: 0.0 }, 0, 10.0, 5);
        w.spawn_anomaly(Position { x: 0.0, y: 0.0, z: 100.0 }, 1, 50.0, 5.0, None);
        w.spawn_wreck(Position { x: 0.0, y: 100.0, z: 0.0 }, "scout".into(), 8.0, 100, 1);
        let snap = build_snapshot(&w);
        assert_eq!(snap.entities.len(), 6, "esperado 2 ships + 1 npc + 1 ast + 1 anom + 1 wreck");
    }

    #[test]
    fn wreck_ttl_decrements_and_removes() {
        let mut w = World::new();
        let id = w.spawn_wreck(Position::default(), "test".into(), 5.0, 3, 0);
        assert!(w.wrecks.contains_key(&id));
        w.step(1.0/30.0);
        assert_eq!(w.wrecks[&id].1.ttl_remaining, 2);
        w.step(1.0/30.0);
        w.step(1.0/30.0);
        // Após 3 steps o TTL chega a 0 e é removido.
        assert!(!w.wrecks.contains_key(&id), "wreck deveria ter sido removido");
        let destroyed = w.take_destroyed();
        assert!(destroyed.contains(&(id, None)), "wreck expirado deveria estar em destroyed");
    }

    #[test]
    fn skill_activation_generates_event() {
        let mut w = World::new();
        let id = w.spawn_player_ship(1, "x".into());
        w.ships.get_mut(&id).unwrap().3.skill_input = Some(ActiveSkill::Dash);
        w.step(1.0/30.0);
        
        let events = w.take_events();
        assert_eq!(events.len(), 1, "Deveria ter gerado 1 evento");
        match events[0] {
            crate::net::protocol::ServerMsg::SkillActivated { entity_id, skill } => {
                assert_eq!(entity_id, id);
                assert_eq!(skill, ActiveSkill::Dash);
            }
            _ => panic!("Esperado evento SkillActivated"),
        }
    }

    #[test]
    fn welcome_includes_world_seed() {
        // Apenas verifica que ServerMsg::Welcome tem o campo via protocolo.
        use crate::net::protocol::ServerMsg;
        let msg = ServerMsg::Welcome {
            player_id: 1,
            protocol: 2,
            tick_rate: 20,
            world_seed: 0xCAFE,
        };
        let bytes = bincode::serialize(&msg).unwrap();
        let back: ServerMsg = bincode::deserialize(&bytes).unwrap();
        match back {
            ServerMsg::Welcome { world_seed, .. } => assert_eq!(world_seed, 0xCAFE),
            _ => panic!("esperado Welcome"),
        }
    }
}

#[cfg(test)]
mod skills_no_combate {
    //! As skills precisam sair do texto e virar efeito.
    //!
    //! A árvore anunciava "+5% weapon damage" e "10% dmg bypasses
    //! shield" desde sempre, o jogador gastava pontos, e nada disso
    //! chegava à simulação: o servidor nunca via as skills. Estes testes
    //! amarram o caminho inteiro — Join → apply_loadout_and_skills →
    //! dano aplicado.

    use super::*;

    fn mundo_com_nave(skills: &[&str]) -> (World, EntityId) {
        let mut w = World::new();
        w.spawn_player_ship(7, "atirador".into());
        let ids: Vec<String> = skills.iter().map(|s| s.to_string()).collect();
        w.apply_loadout_and_skills(7, &["railgun_s".to_string()], &ids);
        let id = *w.player_ships.get(&7).expect("nave criada");
        (w, id)
    }

    #[test]
    fn skill_de_dano_aumenta_o_dano_da_arma_equipada() {
        let (sem, id_sem) = mundo_com_nave(&[]);
        let (com, id_com) = mundo_com_nave(&["combat_t1"]);
        let d_sem = sem.ships[&id_sem].3.weapon.damage;
        let d_com = com.ships[&id_com].3.weapon.damage;
        assert!(
            d_com > d_sem,
            "com skill deveria doer mais: {d_com} vs {d_sem}"
        );
    }

    #[test]
    fn skill_de_cadencia_aumenta_a_cadencia() {
        let (sem, id_sem) = mundo_com_nave(&[]);
        let (com, id_com) = mundo_com_nave(&["combat_t2"]);
        assert!(com.ships[&id_com].3.weapon.fire_rate > sem.ships[&id_sem].3.weapon.fire_rate);
    }

    #[test]
    fn armor_piercing_chega_na_nave() {
        let (com, id) = mundo_com_nave(&["combat_t4"]);
        assert!(com.ships[&id].3.shield_pierce > 0.0);
        let (sem, id_sem) = mundo_com_nave(&[]);
        assert_eq!(sem.ships[&id_sem].3.shield_pierce, 0.0);
    }

    #[test]
    fn aplicar_o_loadout_depois_nao_apaga_as_skills() {
        // O bug que este teste existe para impedir: resolver o loadout
        // sobrescreve `ship.weapon` inteiro. Se alguém chamar
        // `apply_loadout` puro depois das skills, os modificadores
        // somem em silêncio e a árvore volta a ser decorativa.
        let (mut w, id) = mundo_com_nave(&["combat_t1", "combat_t4"]);
        let com_skill = w.ships[&id].3.weapon.damage;

        w.apply_loadout_and_skills(
            7,
            &["railgun_s".to_string()],
            &["combat_t1".to_string(), "combat_t4".to_string()],
        );
        assert!((w.ships[&id].3.weapon.damage - com_skill).abs() < 1e-4);
        assert!(w.ships[&id].3.shield_pierce > 0.0);
    }

    #[test]
    fn sem_skills_o_dano_e_o_do_catalogo() {
        let (w, id) = mundo_com_nave(&[]);
        let catalogo = sim_core::ship::weapons::weapon_profile("railgun_s").unwrap();
        assert!((w.ships[&id].3.weapon.damage - catalogo.damage).abs() < 1e-4);
    }

    #[test]
    fn id_de_skill_inventado_nao_da_bonus() {
        // O cliente manda ids; um cliente adulterado não pode se
        // beneficiar de inventar nós.
        let (falso, id_f) = mundo_com_nave(&["combat_t999", "hack_dano_infinito"]);
        let (limpo, id_l) = mundo_com_nave(&[]);
        assert_eq!(
            falso.ships[&id_f].3.weapon.damage,
            limpo.ships[&id_l].3.weapon.damage
        );
    }
}

#[cfg(test)]
mod habilidades_e_consumiveis {
    //! Habilidades e consumíveis precisam ter EFEITO, não só ícone.
    //!
    //! Antes destes testes: só o Dash era destravado, então as teclas 2
    //! e 3 do HUD não faziam nada; PEM e Reparo existiam no enum e na
    //! interface sem nenhuma nave sendo afetada. E os consumíveis
    //! `repair_kit`/`shield_cell` eram vendidos na loja sem que o
    //! servidor conhecesse os ids.

    use super::*;
    use sim_core::ship::consumables::ConsumableSlot;

    fn carga(id: &str, n: u32) -> ConsumableSlot {
        ConsumableSlot {
            template_id: id.to_string(),
            charges: n,
        }
    }

    fn mundo_com(jogadores: &[u32]) -> World {
        let mut w = World::new();
        for p in jogadores {
            w.spawn_player_ship(*p, format!("p{p}"));
            // Uma nave sem loadout nasce com `hull_max` 100 — cheia. Sem
            // equipar nada, "curar" não teria o que fazer e os testes de
            // cura passariam por acidente, sem exercitar nada.
            w.apply_loadout(*p, &["railgun_s".to_string(), "engine_mk3".to_string()]);
        }
        w
    }

    #[test]
    fn as_tres_habilidades_ficam_destravadas() {
        // O defeito original: só Dash era destravado no spawn, então
        // apertar 2 ou 3 não produzia nem cooldown.
        let w = mundo_com(&[1]);
        let id = w.player_ships[&1];
        let s = &w.ships[&id].3;
        for skill in [ActiveSkill::Dash, ActiveSkill::Emp, ActiveSkill::Repair] {
            assert!(
                s.skills.skills.contains_key(&skill),
                "{skill:?} deveria estar destravada"
            );
        }
    }

    #[test]
    fn reparo_cura_o_casco_ao_longo_do_tempo() {
        let mut w = mundo_com(&[1]);
        let id = w.player_ships[&1];
        w.ships.get_mut(&id).unwrap().3.hull_hp = 100.0;

        w.set_input(1, 0.0, 0.0, 0.0, 0.0, false, 0.0, Some(ActiveSkill::Repair), None);
        w.step(1.0 / 30.0);
        let depois_de_1_tick = w.ships[&id].3.hull_hp;
        assert!(depois_de_1_tick > 100.0, "deveria começar a curar");

        for _ in 0..60 {
            w.step(1.0 / 30.0);
        }
        assert!(
            w.ships[&id].3.hull_hp > depois_de_1_tick + 50.0,
            "a cura tem que continuar durante o efeito"
        );
    }

    #[test]
    fn reparo_para_quando_o_efeito_acaba() {
        // O erro fácil aqui é curar durante o COOLDOWN (20s) em vez de
        // durante o efeito (5s), o que quadruplicaria a cura.
        let mut w = mundo_com(&[1]);
        let id = w.player_ships[&1];
        w.ships.get_mut(&id).unwrap().3.hull_hp = 100.0;
        w.set_input(1, 0.0, 0.0, 0.0, 0.0, false, 0.0, Some(ActiveSkill::Repair), None);

        for _ in 0..(30 * 6) {
            w.step(1.0 / 30.0);
        }
        let ao_fim = w.ships[&id].3.hull_hp;
        for _ in 0..(30 * 5) {
            w.step(1.0 / 30.0);
        }
        assert!(
            (w.ships[&id].3.hull_hp - ao_fim).abs() < 1.0,
            "não pode continuar curando depois dos 5s de efeito"
        );
    }

    #[test]
    fn pem_paralisa_inimigo_proximo() {
        let mut w = mundo_com(&[1, 2]);
        let alvo = w.player_ships[&2];
        // Aproxima o alvo: o raio do PEM é 220.
        let p = w.ships[&w.player_ships[&1]].0;
        w.ships.get_mut(&alvo).unwrap().0 = Position {
            x: p.x + 50.0,
            y: p.y,
            z: p.z,
        };

        w.set_input(1, 0.0, 0.0, 0.0, 0.0, false, 0.0, Some(ActiveSkill::Emp), None);
        w.step(1.0 / 30.0);

        assert!(
            w.ships[&alvo].3.emp_remaining > 0.0,
            "inimigo no raio deveria ficar paralisado"
        );
    }

    #[test]
    fn pem_nao_atinge_quem_usou() {
        let mut w = mundo_com(&[1]);
        let id = w.player_ships[&1];
        w.set_input(1, 0.0, 0.0, 0.0, 0.0, false, 0.0, Some(ActiveSkill::Emp), None);
        w.step(1.0 / 30.0);
        assert_eq!(w.ships[&id].3.emp_remaining, 0.0);
    }

    #[test]
    fn pem_nao_alcanca_alvo_distante() {
        let mut w = mundo_com(&[1, 2]);
        let alvo = w.player_ships[&2];
        let p = w.ships[&w.player_ships[&1]].0;
        w.ships.get_mut(&alvo).unwrap().0 = Position {
            x: p.x + 5000.0,
            y: p.y,
            z: p.z,
        };
        w.set_input(1, 0.0, 0.0, 0.0, 0.0, false, 0.0, Some(ActiveSkill::Emp), None);
        w.step(1.0 / 30.0);
        assert_eq!(w.ships[&alvo].3.emp_remaining, 0.0);
    }

    #[test]
    fn nave_sob_pem_nao_acelera_nem_atira() {
        let mut w = mundo_com(&[1]);
        let id = w.player_ships[&1];
        w.ships.get_mut(&id).unwrap().3.emp_remaining = 3.0;
        let projeteis_antes = w.projectiles.len();

        w.set_input(1, 0.0, 0.0, 0.0, 1.0, true, 0.0, None, None);
        for _ in 0..10 {
            w.step(1.0 / 30.0);
        }

        let v = w.ships[&id].1;
        let velocidade = (v.x * v.x + v.y * v.y + v.z * v.z).sqrt();
        assert!(velocidade < 1.0, "empuxo deveria estar cortado: {velocidade}");
        assert_eq!(
            w.projectiles.len(),
            projeteis_antes,
            "não pode atirar sob PEM"
        );
    }

    #[test]
    fn consumivel_de_reparo_cura_na_hora() {
        let mut w = mundo_com(&[1]);
        let id = w.player_ships[&1];
        w.apply_consumables(1, &[carga("repair_kit", 2)]);
        w.ships.get_mut(&id).unwrap().3.hull_hp = 100.0;

        w.set_input(1, 0.0, 0.0, 0.0, 0.0, false, 0.0, None, Some(0));
        w.step(1.0 / 30.0);

        // Instantâneo, ao contrário da skill de reparo: é o que o
        // jogador compra com a escassez da carga.
        assert!(w.ships[&id].3.hull_hp > 400.0);
        assert_eq!(w.ships[&id].3.belt.charges_at(0), 1);
    }

    #[test]
    fn celula_de_escudo_restaura_escudo_e_nao_casco() {
        let mut w = mundo_com(&[1]);
        let id = w.player_ships[&1];
        w.apply_consumables(1, &[carga("shield_cell", 1)]);
        {
            let s = &mut w.ships.get_mut(&id).unwrap().3;
            s.shield_max = 500.0;
            s.shield_hp = 0.0;
            s.hull_hp = 200.0;
        }

        w.set_input(1, 0.0, 0.0, 0.0, 0.0, false, 0.0, None, Some(0));
        w.step(1.0 / 30.0);

        assert!(w.ships[&id].3.shield_hp > 200.0, "escudo deveria subir");
        assert_eq!(w.ships[&id].3.hull_hp, 200.0, "casco não é afetado");
    }

    #[test]
    fn consumivel_sem_carga_nao_faz_nada() {
        let mut w = mundo_com(&[1]);
        let id = w.player_ships[&1];
        w.apply_consumables(1, &[carga("repair_kit", 1)]);
        w.ships.get_mut(&id).unwrap().3.hull_hp = 100.0;

        w.set_input(1, 0.0, 0.0, 0.0, 0.0, false, 0.0, None, Some(0));
        w.step(1.0 / 30.0);
        let apos_primeiro = w.ships[&id].3.hull_hp;

        // Passa o cooldown e tenta de novo, já sem carga.
        for _ in 0..(30 * 7) {
            w.step(1.0 / 30.0);
        }
        w.ships.get_mut(&id).unwrap().3.hull_hp = apos_primeiro;
        w.set_input(1, 0.0, 0.0, 0.0, 0.0, false, 0.0, None, Some(0));
        w.step(1.0 / 30.0);

        assert_eq!(w.ships[&id].3.hull_hp, apos_primeiro);
    }

    #[test]
    fn cinto_ignora_id_desconhecido() {
        let mut w = mundo_com(&[1]);
        let id = w.player_ships[&1];
        w.apply_consumables(1, &[carga("cura_infinita", 99)]);
        assert!(w.ships[&id].3.belt.slots.is_empty());
    }

    #[test]
    fn usar_consumivel_emite_evento_com_as_cargas_restantes() {
        // O HUD depende disso: contar localmente divergiria na primeira
        // recusa por cooldown.
        let mut w = mundo_com(&[1]);
        w.apply_consumables(1, &[carga("repair_kit", 3)]);
        w.set_input(1, 0.0, 0.0, 0.0, 0.0, false, 0.0, None, Some(0));
        w.step(1.0 / 30.0);

        let evento = w.events.iter().find_map(|e| match e {
            crate::net::protocol::ServerMsg::ConsumableUsed { charges_left, .. } => {
                Some(*charges_left)
            }
            _ => None,
        });
        assert_eq!(evento, Some(2));
    }
}

impl World {
    /// Lança um torpedo da nave de `player_id` contra `target`.
    ///
    /// Silenciosamente ignorado quando a nave não tem lançador equipado,
    /// quando o alvo não existe, ou quando ele está fora do alcance de
    /// travamento — o cliente pede, o servidor decide.
    pub fn launch_torpedo(&mut self, player_id: u32, target: EntityId) {
        let Some(&id) = self.player_ships.get(&player_id) else { return };
        let Some((pos, _, rot, ship)) = self.ships.get(&id).cloned() else { return };
        let Some(perfil) = ship.torpedo else { return };
        if ship.torpedo_cooldown > 0.0 || ship.emp_remaining > 0.0 {
            return;
        }
        // O alvo tem que existir e não ser a própria nave.
        if target == id {
            return;
        }
        let Some((tpos, _, _, _)) = self.ships.get(&target) else { return };
        let d2 = dist_sq(pos, *tpos);
        if d2 > perfil.lock_range * perfil.lock_range {
            return;
        }

        let fwd = forward(&rot);
        let torp = sim_core::ship::torpedo::Torpedo::new(perfil, ship.owner_player_id, fwd, target);
        // Nasce à frente da nave, como o projétil.
        let saida = Position {
            x: pos.x + fwd[0] * 4.0,
            y: pos.y + fwd[1] * 4.0,
            z: pos.z + fwd[2] * 4.0,
        };
        let tid = self.alloc_id();
        self.torpedoes.insert(tid, (saida, torp));

        if let Some((_, _, _, s)) = self.ships.get_mut(&id) {
            s.torpedo_cooldown = TORPEDO_COOLDOWN;
        }
        self.events.push(crate::net::protocol::ServerMsg::Vfx {
            effect_id: VFX_MUZZLE,
            pos: [saida.x, saida.y, saida.z],
        });
    }

    /// Solta iscas de dispersão a partir da nave do jogador.
    ///
    /// É a terceira defesa: não custa a dobra nem exige acertar um alvo
    /// pequeno, mas gasta uma carga.
    pub fn deploy_decoys(&mut self, player_id: u32) {
        use sim_core::ship::consumables::{decoy_slot, UseOutcome};
        let Some(&id) = self.player_ships.get(&player_id) else { return };
        let Some((pos, _, _, ship)) = self.ships.get(&id) else { return };
        let p = *pos;
        let dono = ship.owner_player_id;

        // As iscas CUSTAM uma carga. Sem isto seriam infinitas, e a
        // defesa mais fácil contra torpedo passaria a ser gratuita —
        // as outras três (manobrar, dobra, abater) deixariam de ter
        // qualquer motivo para existir.
        let Some(slot) = self
            .ships
            .get(&id)
            .and_then(|(_, _, _, s)| decoy_slot(&s.belt))
        else {
            return;
        };
        let usado = self
            .ships
            .get_mut(&id)
            .map(|(_, _, _, s)| s.belt.use_slot(slot))
            .unwrap_or(UseOutcome::Rejected);
        let UseOutcome::Used { vfx, .. } = usado else { return };

        let restantes = self.ships[&id].3.belt.charges_at(slot);
        self.events.push(crate::net::protocol::ServerMsg::ConsumableUsed {
            entity_id: id,
            slot: slot as u8,
            vfx,
            charges_left: restantes,
        });

        self.decoys.push((p, DECOY_TTL, dono));
        self.events.push(crate::net::protocol::ServerMsg::Vfx {
            effect_id: VFX_DECOY,
            pos: [p.x, p.y, p.z],
        });
    }

    /// Avança os torpedos: perseguição, trava, colisão e expiração.
    fn step_torpedoes(&mut self, dt: f32) {
        use sim_core::ship::torpedo::{check_lock, LockLost};

        // Envelhece as iscas antes de consultá-las: uma isca com TTL
        // zerado não deve mais confundir ninguém.
        for d in &mut self.decoys {
            d.1 -= dt;
        }
        self.decoys.retain(|d| d.1 > 0.0);

        let ids: Vec<EntityId> = self.torpedoes.keys().copied().collect();
        let mut removidos: Vec<EntityId> = Vec::new();
        let mut impactos: Vec<(EntityId, f32, f32, u32, Position)> = Vec::new();

        for tid in ids {
            let Some((pos, torp)) = self.torpedoes.get(&tid).cloned() else { continue };
            let mut torp = torp;
            let mut pos = pos;

            // --- Trava ---
            let alvo_pos = torp.target.and_then(|t| {
                self.ships
                    .get(&t)
                    .map(|(p, v, _, _)| (*p, (v.x * v.x + v.y * v.y + v.z * v.z).sqrt()))
            });

            match alvo_pos {
                Some((tp, vel_alvo)) => {
                    let dist = dist_sq(pos, tp).sqrt();
                    // Isca perto do ALVO, não do torpedo: é o alvo que
                    // se esconde atrás delas.
                    let iscas = self
                        .decoys
                        .iter()
                        .any(|(dp, _, _)| dist_sq(*dp, tp) <= DECOY_RADIUS * DECOY_RADIUS);
                    if let Err(motivo) = check_lock(vel_alvo, dist, torp.profile.lock_range, iscas) {
                        torp.lose_lock();
                        self.events.push(crate::net::protocol::ServerMsg::TorpedoLockLost {
                            torpedo_id: tid,
                            reason: match motivo {
                                LockLost::TooFast => 0,
                                LockLost::Decoyed => 1,
                                LockLost::OutOfRange => 2,
                            },
                        });
                    }
                }
                // Alvo destruído no meio do voo.
                None => torp.lose_lock(),
            }

            let alvo_ponto = torp
                .target
                .and_then(|t| self.ships.get(&t))
                .map(|(p, _, _, _)| [p.x, p.y, p.z]);

            torp.step(dt, [pos.x, pos.y, pos.z], alvo_ponto);
            pos = Position {
                x: pos.x + torp.dir[0] * torp.speed * dt,
                y: pos.y + torp.dir[1] * torp.speed * dt,
                z: pos.z + torp.dir[2] * torp.speed * dt,
            };

            if torp.expired() {
                removidos.push(tid);
                self.events.push(crate::net::protocol::ServerMsg::Vfx {
                    effect_id: VFX_IMPACT,
                    pos: [pos.x, pos.y, pos.z],
                });
                continue;
            }

            // --- Colisão com naves ---
            let mut acertou = None;
            for (sid, (sp, _, _, s)) in &self.ships {
                if s.owner_player_id == torp.owner_player_id {
                    continue;
                }
                // Naves em dobra são imunes, igual aos projéteis: o
                // salto tem que ser fuga, não armadilha.
                if s.warp_remaining > 0.0 {
                    continue;
                }
                let raio = torp.profile.radius + s.radius;
                if dist_sq(pos, *sp) <= raio * raio {
                    acertou = Some(*sid);
                    break;
                }
            }
            if let Some(sid) = acertou {
                impactos.push((
                    sid,
                    torp.profile.damage,
                    torp.profile.splash_radius,
                    torp.owner_player_id,
                    pos,
                ));
                removidos.push(tid);
                continue;
            }

            self.torpedoes.insert(tid, (pos, torp));
        }

        for tid in removidos {
            self.torpedoes.remove(&tid);
            self.destroyed.push((tid, None));
        }

        for (sid, dano, splash, atacante, ponto) in impactos {
            self.apply_torpedo_hit(sid, dano, splash, atacante, ponto);
        }
    }

    fn apply_torpedo_hit(
        &mut self,
        alvo: EntityId,
        dano: f32,
        splash: f32,
        atacante: u32,
        ponto: Position,
    ) {
        let mut alvos: Vec<(EntityId, f32)> = vec![(alvo, dano)];
        if splash > 0.0 {
            let r2 = splash * splash;
            for (sid, (sp, _, _, s)) in &self.ships {
                if *sid == alvo || s.owner_player_id == atacante {
                    continue;
                }
                let d2 = dist_sq(*sp, ponto);
                if d2 <= r2 {
                    let f = 1.0 - d2.sqrt() / splash;
                    alvos.push((*sid, dano * f * 0.6));
                }
            }
        }
        for (sid, d) in alvos {
            if let Some((p, v, r, ship)) = self.ships.get(&sid).cloned() {
                let mut novo = ship;
                let absorvido = d.min(novo.shield_hp);
                novo.shield_hp -= absorvido;
                novo.hull_hp = (novo.hull_hp - (d - absorvido)).max(0.0);
                if novo.hull_hp <= 0.0 {
                    self.destroyed
                        .push((sid, if atacante != 0 { Some(atacante) } else { None }));
                }
                self.ships.insert(sid, (p, v, r, novo));
            }
        }
        self.events.push(crate::net::protocol::ServerMsg::Vfx {
            effect_id: VFX_EXPLOSION_LARGE,
            pos: [ponto.x, ponto.y, ponto.z],
        });
    }

    /// Projéteis podem ABATER torpedos — a quarta defesa.
    ///
    /// Roda depois da colisão normal de projéteis: um tiro gasto num
    /// torpedo é um tiro que não foi para quem o lançou, e esse é
    /// justamente o custo desta saída.
    fn projectiles_vs_torpedoes(&mut self) {
        let proj_ids: Vec<EntityId> = self.projectiles.keys().copied().collect();
        let mut proj_gastos: Vec<EntityId> = Vec::new();
        let mut torp_abatidos: Vec<(EntityId, Position)> = Vec::new();

        for pid in proj_ids {
            let Some((ppos, _, proj)) = self.projectiles.get(&pid).cloned() else { continue };
            for (tid, (tpos, torp)) in self.torpedoes.iter_mut() {
                // Não abate o próprio torpedo.
                if torp.owner_player_id == proj.owner_player_id {
                    continue;
                }
                let raio = proj.radius + torp.profile.radius;
                if dist_sq(ppos, *tpos) > raio * raio {
                    continue;
                }
                if torp.take_damage(proj.damage) {
                    torp_abatidos.push((*tid, *tpos));
                }
                proj_gastos.push(pid);
                break;
            }
        }

        for pid in proj_gastos {
            self.projectiles.remove(&pid);
            self.destroyed.push((pid, None));
        }
        for (tid, pos) in torp_abatidos {
            self.torpedoes.remove(&tid);
            self.destroyed.push((tid, None));
            self.events.push(crate::net::protocol::ServerMsg::Vfx {
                effect_id: VFX_EXPLOSION_LARGE,
                pos: [pos.x, pos.y, pos.z],
            });
        }
    }
}

#[cfg(test)]
mod torpedos_e_defesas {
    //! As quatro defesas contra torpedo, no mundo de verdade.
    //!
    //! Um torpedo indefensável vira imposto e um que se perde sozinho
    //! vira enfeite. O equilíbrio inteiro está em cada uma destas saídas
    //! funcionar — e é fácil quebrar uma delas sem notar, porque as três
    //! outras continuam passando.

    use super::*;

    fn arena(jogadores: &[u32]) -> World {
        let mut w = World::new();
        for p in jogadores {
            w.spawn_player_ship(*p, format!("p{p}"));
            w.apply_loadout(
                *p,
                &[
                    "railgun_s".to_string(),
                    "engine_mk3".to_string(),
                    "torpedo_seeker".to_string(),
                ],
            );
        }
        w
    }

    /// Coloca o alvo a `dist` unidades do atirador, no eixo Z.
    fn posicionar(w: &mut World, atirador: u32, alvo: u32, dist: f32) -> (EntityId, EntityId) {
        let a = w.player_ships[&atirador];
        let b = w.player_ships[&alvo];
        let pa = w.ships[&a].0;
        w.ships.get_mut(&b).unwrap().0 = Position {
            x: pa.x,
            y: pa.y,
            z: pa.z + dist,
        };
        (a, b)
    }

    #[test]
    fn lancador_equipado_pelo_loadout() {
        let w = arena(&[1]);
        let id = w.player_ships[&1];
        assert!(w.ships[&id].3.torpedo.is_some());
    }

    #[test]
    fn sem_lancador_nao_lanca() {
        let mut w = World::new();
        w.spawn_player_ship(1, "a".into());
        w.spawn_player_ship(2, "b".into());
        w.apply_loadout(1, &["railgun_s".to_string()]);
        posicionar(&mut w, 1, 2, 200.0);
        let alvo = w.player_ships[&2];
        w.launch_torpedo(1, alvo);
        assert!(w.torpedoes.is_empty());
    }

    #[test]
    fn lanca_e_o_torpedo_aparece() {
        let mut w = arena(&[1, 2]);
        let (_, alvo) = posicionar(&mut w, 1, 2, 200.0);
        w.launch_torpedo(1, alvo);
        assert_eq!(w.torpedoes.len(), 1);
    }

    #[test]
    fn nao_lanca_contra_si_mesmo() {
        let mut w = arena(&[1]);
        let eu = w.player_ships[&1];
        w.launch_torpedo(1, eu);
        assert!(w.torpedoes.is_empty());
    }

    #[test]
    fn nao_lanca_fora_do_alcance_de_trava() {
        let mut w = arena(&[1, 2]);
        let (_, alvo) = posicionar(&mut w, 1, 2, 5000.0);
        w.launch_torpedo(1, alvo);
        assert!(w.torpedoes.is_empty());
    }

    #[test]
    fn cooldown_impede_disparo_em_rajada() {
        // Um lançador de repetição transformaria o combate em administrar
        // torpedos em vez de pilotar.
        let mut w = arena(&[1, 2]);
        let (_, alvo) = posicionar(&mut w, 1, 2, 200.0);
        w.launch_torpedo(1, alvo);
        w.launch_torpedo(1, alvo);
        assert_eq!(w.torpedoes.len(), 1);
    }

    #[test]
    fn nave_sob_pem_nao_lanca() {
        let mut w = arena(&[1, 2]);
        let (eu, alvo) = posicionar(&mut w, 1, 2, 200.0);
        w.ships.get_mut(&eu).unwrap().3.emp_remaining = 3.0;
        w.launch_torpedo(1, alvo);
        assert!(w.torpedoes.is_empty());
    }

    // ------------------------------------------------ Defesa: impulso
    #[test]
    fn dobra_quebra_a_trava_do_torpedo() {
        let mut w = arena(&[1, 2]);
        let (_, alvo) = posicionar(&mut w, 1, 2, 200.0);
        w.launch_torpedo(1, alvo);

        // Alvo em velocidade de dobra.
        w.ships.get_mut(&alvo).unwrap().1 = Velocity {
            x: 0.0,
            y: 0.0,
            z: 600.0,
        };
        w.step(1.0 / 30.0);

        let travado = w.torpedoes.values().next().map(|(_, t)| t.target.is_some());
        assert_eq!(travado, Some(false), "a dobra deveria ter quebrado a trava");
    }

    #[test]
    fn voo_rapido_normal_nao_quebra_a_trava() {
        // Escapar tem que exigir a habilidade, não acontecer numa reta.
        let mut w = arena(&[1, 2]);
        let (_, alvo) = posicionar(&mut w, 1, 2, 200.0);
        w.launch_torpedo(1, alvo);
        w.ships.get_mut(&alvo).unwrap().1 = Velocity {
            x: 0.0,
            y: 0.0,
            z: 150.0,
        };
        w.step(1.0 / 30.0);
        let travado = w.torpedoes.values().next().map(|(_, t)| t.target.is_some());
        assert_eq!(travado, Some(true));
    }

    // ----------------------------------------------- Defesa: dispersão
    #[test]
    fn iscas_quebram_a_trava() {
        let mut w = arena(&[1, 2]);
        let (_, alvo) = posicionar(&mut w, 1, 2, 200.0);
        w.launch_torpedo(1, alvo);
        // As iscas custam uma carga: sem elas equipadas, não há defesa.
        w.apply_consumables(
            2,
            &[sim_core::ship::consumables::ConsumableSlot {
                template_id: "decoy_flare".into(),
                charges: 2,
            }],
        );
        w.deploy_decoys(2);
        w.step(1.0 / 30.0);
        let travado = w.torpedoes.values().next().map(|(_, t)| t.target.is_some());
        assert_eq!(travado, Some(false), "as iscas deveriam ter enganado o rastreador");
    }

    #[test]
    fn sem_carga_de_iscas_nada_e_solto() {
        // As iscas seriam a defesa gratuita se não custassem nada, e as
        // outras três perderiam o motivo de existir.
        let mut w = arena(&[1, 2]);
        posicionar(&mut w, 1, 2, 200.0);
        w.deploy_decoys(2);
        assert!(w.decoys.is_empty());
    }

    #[test]
    fn iscas_expiram_e_param_de_proteger() {
        let mut w = arena(&[1, 2]);
        posicionar(&mut w, 1, 2, 200.0);
        w.apply_consumables(
            2,
            &[sim_core::ship::consumables::ConsumableSlot {
                template_id: "decoy_flare".into(),
                charges: 2,
            }],
        );
        w.deploy_decoys(2);
        assert_eq!(w.decoys.len(), 1);
        for _ in 0..(30 * 5) {
            w.step(1.0 / 30.0);
        }
        assert!(w.decoys.is_empty(), "as iscas têm que expirar");
    }

    // --------------------------------------------------- Defesa: tiro
    #[test]
    fn projetil_inimigo_abate_o_torpedo() {
        let mut w = arena(&[1, 2]);
        let (_, alvo) = posicionar(&mut w, 1, 2, 300.0);
        w.launch_torpedo(1, alvo);
        let (tpos, _) = w.torpedoes.values().next().cloned().unwrap();

        // Um projétil do ALVO, em cima do torpedo, com dano suficiente.
        let pid = w.alloc_id();
        let proj = Projectile {
            owner_player_id: 2,
            owner_entity: alvo,
            damage: 500.0,
            ttl_remaining: 3.0,
            radius: 2.0,
            speed: 100.0,
            splash_radius: 0.0,
            visual: 0,
            charge: 0.0,
        };
        w.projectiles.insert(
            pid,
            (
                tpos,
                Velocity {
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
                proj,
            ),
        );

        w.projectiles_vs_torpedoes();
        assert!(w.torpedoes.is_empty(), "o torpedo deveria ter sido abatido");
    }

    #[test]
    fn o_proprio_projetil_nao_abate_o_proprio_torpedo() {
        // Senão a salva de tiros do atirador destruiria o próprio
        // torpedo ao segui-lo.
        let mut w = arena(&[1, 2]);
        let (eu, alvo) = posicionar(&mut w, 1, 2, 300.0);
        w.launch_torpedo(1, alvo);
        let (tpos, _) = w.torpedoes.values().next().cloned().unwrap();

        let pid = w.alloc_id();
        let proj = Projectile {
            owner_player_id: 1,
            owner_entity: eu,
            damage: 500.0,
            ttl_remaining: 3.0,
            radius: 2.0,
            speed: 100.0,
            splash_radius: 0.0,
            visual: 0,
            charge: 0.0,
        };
        w.projectiles.insert(
            pid,
            (
                tpos,
                Velocity {
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
                proj,
            ),
        );

        w.projectiles_vs_torpedoes();
        assert_eq!(w.torpedoes.len(), 1);
    }

    #[test]
    fn um_tiro_fraco_nao_derruba_o_torpedo_de_uma_vez() {
        // O torpedo tem casco: abater custa dano, não um toque.
        let mut w = arena(&[1, 2]);
        let (_, alvo) = posicionar(&mut w, 1, 2, 300.0);
        w.launch_torpedo(1, alvo);
        let (tpos, _) = w.torpedoes.values().next().cloned().unwrap();

        let pid = w.alloc_id();
        let proj = Projectile {
            owner_player_id: 2,
            owner_entity: alvo,
            damage: 5.0,
            ttl_remaining: 3.0,
            radius: 2.0,
            speed: 100.0,
            splash_radius: 0.0,
            visual: 0,
            charge: 0.0,
        };
        w.projectiles.insert(
            pid,
            (
                tpos,
                Velocity {
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
                proj,
            ),
        );

        w.projectiles_vs_torpedoes();
        assert_eq!(w.torpedoes.len(), 1, "5 de dano não derruba 40 de casco");
        // Mas o projétil foi gasto: é o custo desta defesa.
        assert!(w.projectiles.is_empty());
    }

    // ---------------------------------------------------- Defesa: fuga
    #[test]
    fn o_torpedo_expira_sem_combustivel() {
        let mut w = arena(&[1, 2]);
        let (_, alvo) = posicionar(&mut w, 1, 2, 200.0);
        w.launch_torpedo(1, alvo);
        // Alvo fora de alcance: nada a perseguir de perto.
        w.ships.get_mut(&alvo).unwrap().0 = Position {
            x: 0.0,
            y: 0.0,
            z: 40_000.0,
        };
        for _ in 0..(30 * 9) {
            w.step(1.0 / 30.0);
        }
        assert!(w.torpedoes.is_empty(), "deveria ter ficado sem combustível");
    }

    #[test]
    fn torpedo_atinge_alvo_parado_e_causa_dano() {
        // O contrapeso: se ninguém nunca fosse atingido, o torpedo
        // seria decorativo e as defesas não teriam sentido.
        let mut w = arena(&[1, 2]);
        let (_, alvo) = posicionar(&mut w, 1, 2, 150.0);
        let hp_antes = w.ships[&alvo].3.hull_hp + w.ships[&alvo].3.shield_hp;
        w.launch_torpedo(1, alvo);
        for _ in 0..(30 * 7) {
            w.step(1.0 / 30.0);
            if w.torpedoes.is_empty() {
                break;
            }
        }
        let hp_depois = w.ships[&alvo].3.hull_hp + w.ships[&alvo].3.shield_hp;
        assert!(
            hp_depois < hp_antes,
            "alvo parado deveria levar dano: {hp_antes} -> {hp_depois}"
        );
    }

    #[test]
    fn nave_em_dobra_e_imune_ao_impacto() {
        // Mesma regra dos projéteis: o salto tem que ser fuga, não
        // armadilha.
        let mut w = arena(&[1, 2]);
        let (_, alvo) = posicionar(&mut w, 1, 2, 60.0);
        w.launch_torpedo(1, alvo);
        w.ships.get_mut(&alvo).unwrap().3.warp_remaining = 5.0;
        let hp_antes = w.ships[&alvo].3.hull_hp;
        for _ in 0..30 {
            w.step(1.0 / 30.0);
        }
        assert_eq!(w.ships[&alvo].3.hull_hp, hp_antes);
    }

    #[test]
    fn torpedo_aparece_no_snapshot_com_payload() {
        // O alvo precisa ver o torpedo para reagir a ele.
        let mut w = arena(&[1, 2]);
        let (_, alvo) = posicionar(&mut w, 1, 2, 200.0);
        w.launch_torpedo(1, alvo);
        w.step(1.0 / 30.0);

        let snap = build_snapshot(&w);
        let t = snap
            .entities
            .iter()
            .find(|e| e.kind == crate::net::protocol::EntityKind::Torpedo);
        assert!(t.is_some(), "o torpedo tem que aparecer no snapshot");
        let payload = t.unwrap().payload.as_ref().unwrap();
        match payload {
            crate::net::protocol::EntityPayload::Torpedo(tp) => {
                assert!(tp.locked, "ainda perseguindo");
                assert!(tp.hp_ratio > 0.0);
            }
            outro => panic!("payload errado: {outro:?}"),
        }
    }
}

impl World {
    /// Monta o campo de provas ao redor da nave do jogador.
    ///
    /// Os alvos são NAVES de verdade, não um tipo à parte: assim eles
    /// passam pelos mesmos caminhos de dano, escudo, travamento e
    /// colisão que um adversário humano. Um alvo de treino com física
    /// própria testaria o alvo de treino, não o jogo.
    pub fn spawn_training_range(&mut self, player_id: u32) {
        use sim_core::ship::training::{training_range, TrainingDummy};

        let Some(&id) = self.player_ships.get(&player_id) else { return };
        let Some((pos, _, _, _)) = self.ships.get(&id) else { return };
        let centro = *pos;

        for (i, kind) in training_range().into_iter().enumerate() {
            // Espalhados em ângulos distintos ao redor do jogador, para
            // não nascerem em linha e se esconderem uns atrás dos outros.
            let ang = (i as f32) * (std::f32::consts::TAU / 3.0);
            let d = kind.spawn_distance();
            let ancora = Position {
                x: centro.x + ang.cos() * d,
                y: centro.y + (i as f32 - 1.0) * 30.0,
                z: centro.z + ang.sin() * d,
            };

            let tid = self.alloc_id();
            let mut ship = Ship {
                // `owner_player_id` 0 marca "sem dono humano". É o que
                // torna os alvos hostis a todos os jogadores sem
                // precisar de um sistema de facções.
                owner_player_id: 0,
                name: kind.label().to_string(),
                hull_max: kind.hull(),
                hull_hp: kind.hull(),
                shield_max: 200.0,
                shield_hp: 200.0,
                radius: 6.0,
                training: Some(TrainingDummy::new(
                    kind,
                    [ancora.x, ancora.y, ancora.z],
                )),
                ..Default::default()
            };
            // O caçador precisa de lançador para poder atacar.
            if kind == sim_core::ship::training::TrainingKind::Cacador {
                ship.torpedo = sim_core::ship::torpedo::torpedo_profile("torpedo_seeker");
            }

            self.ships.insert(
                tid,
                (ancora, Velocity::default(), Rotation::default(), ship),
            );
        }
    }

    /// Avança os alvos de treino.
    ///
    /// A posição é ESCRITA diretamente, em vez de passar pelo laço de
    /// voo: alvos de treino têm que ser previsíveis, e um alvo sujeito a
    /// arrasto e gravidade sairia de curso e deixaria de exercitar o que
    /// se quer medir. Tudo o mais — dano, escudo, travamento, colisão —
    /// continua passando pelos caminhos normais.
    fn step_training(&mut self, dt: f32) {
        let alvo_humano = self
            .player_ships
            .values()
            .next()
            .and_then(|id| self.ships.get(id))
            .map(|(p, _, _, _)| [p.x, p.y, p.z]);

        let ids: Vec<EntityId> = self
            .ships
            .iter()
            .filter(|(_, (_, _, _, s))| s.training.is_some())
            .map(|(id, _)| *id)
            .collect();

        let mut lancamentos: Vec<(EntityId, Position, u32)> = Vec::new();

        for id in ids {
            let Some((pos, vel, rot, ship)) = self.ships.get_mut(&id) else { continue };
            let Some(dummy) = ship.training.as_mut() else { continue };
            let acao = dummy.step(dt, alvo_humano.unwrap_or([0.0, 0.0, 0.0]));

            pos.x = acao.position[0];
            pos.y = acao.position[1];
            pos.z = acao.position[2];
            // A velocidade informada alimenta a mira do jogador: é ela
            // que a solução de antecipação usa. Se divergisse do
            // movimento real, o alvo que existe para treinar antecipação
            // ensinaria o erro.
            vel.x = acao.velocity[0];
            vel.y = acao.velocity[1];
            vel.z = acao.velocity[2];

            // Aponta para o jogador, para o torpedo sair na direção
            // certa e a silhueta fazer sentido.
            if let Some(alvo) = alvo_humano {
                let d = [alvo[0] - pos.x, alvo[1] - pos.y, alvo[2] - pos.z];
                let l = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
                if l > 0.001 {
                    *rot = look_rotation([d[0] / l, d[1] / l, d[2] / l]);
                }
            }

            if acao.launch_torpedo && ship.torpedo.is_some() {
                lancamentos.push((id, *pos, ship.owner_player_id));
            }
        }

        // Lançamentos fora do laço: `self.ships` estava emprestado.
        for (origem, pos, dono) in lancamentos {
            let Some(alvo_id) = self.player_ships.values().next().copied() else { continue };
            let Some(perfil) = self.ships.get(&origem).and_then(|(_, _, _, s)| s.torpedo) else {
                continue;
            };
            let rot = self.ships[&origem].2;
            let fwd = forward(&rot);
            let torp =
                sim_core::ship::torpedo::Torpedo::new(perfil, dono, fwd, alvo_id);
            let saida = Position {
                x: pos.x + fwd[0] * 6.0,
                y: pos.y + fwd[1] * 6.0,
                z: pos.z + fwd[2] * 6.0,
            };
            let tid = self.alloc_id();
            self.torpedoes.insert(tid, (saida, torp));
            self.events.push(crate::net::protocol::ServerMsg::Vfx {
                effect_id: VFX_MUZZLE,
                pos: [saida.x, saida.y, saida.z],
            });
        }
    }
}

/// Rotação que aponta o eixo +Z (a frente da nave) para `dir`.
fn look_rotation(dir: [f32; 3]) -> Rotation {
    // Quaternion que leva +Z até `dir`, pelo caminho mais curto.
    let f = [0.0f32, 0.0, 1.0];
    let dot = f[0] * dir[0] + f[1] * dir[1] + f[2] * dir[2];
    if dot > 0.999_999 {
        return Rotation::default();
    }
    if dot < -0.999_999 {
        // Oposto exato: gira 180° em torno de um eixo perpendicular.
        return Rotation {
            x: 0.0,
            y: 1.0,
            z: 0.0,
            w: 0.0,
        };
    }
    let eixo = [
        f[1] * dir[2] - f[2] * dir[1],
        f[2] * dir[0] - f[0] * dir[2],
        f[0] * dir[1] - f[1] * dir[0],
    ];
    let s = ((1.0 + dot) * 2.0).sqrt();
    let inv = 1.0 / s;
    let q = Rotation {
        x: eixo[0] * inv,
        y: eixo[1] * inv,
        z: eixo[2] * inv,
        w: s * 0.5,
    };
    let n = (q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w).sqrt();
    if n < 1e-6 {
        return Rotation::default();
    }
    Rotation {
        x: q.x / n,
        y: q.y / n,
        z: q.z / n,
        w: q.w / n,
    }
}

#[cfg(test)]
mod campo_de_provas {
    //! O campo de provas precisa exercitar as mecânicas DE VERDADE.
    //!
    //! O risco de um modo de treino é ele testar a si mesmo: alvos com
    //! física própria, imunes a dano, ou invisíveis para o travamento
    //! dariam a sensação de estar verificando o jogo sem verificar nada.
    //! Estes testes fixam que os alvos são naves comuns nos caminhos que
    //! importam.

    use super::*;
    use sim_core::ship::training::TrainingKind;

    fn arena_de_treino() -> (World, u32) {
        let mut w = World::new();
        w.spawn_player_ship(1, "piloto".into());
        w.apply_loadout(1, &["railgun_s".to_string(), "engine_mk3".to_string()]);
        w.spawn_training_range(1);
        (w, 1)
    }

    fn alvos(w: &World) -> Vec<EntityId> {
        let mut v: Vec<EntityId> = w
            .ships
            .iter()
            .filter(|(_, (_, _, _, s))| s.training.is_some())
            .map(|(id, _)| *id)
            .collect();
        v.sort();
        v
    }

    #[test]
    fn cria_os_tres_alvos() {
        let (w, _) = arena_de_treino();
        assert_eq!(alvos(&w).len(), 3);
    }

    #[test]
    fn os_alvos_nascem_separados_uns_dos_outros() {
        // Empilhados, escondem-se atrás uns dos outros e não dá para
        // escolher qual exercitar.
        let (w, _) = arena_de_treino();
        let ids = alvos(&w);
        for i in 0..ids.len() {
            for j in (i + 1)..ids.len() {
                let a = w.ships[&ids[i]].0;
                let b = w.ships[&ids[j]].0;
                assert!(
                    dist_sq(a, b).sqrt() > 50.0,
                    "alvos {i} e {j} nasceram colados"
                );
            }
        }
    }

    #[test]
    fn os_alvos_sao_naves_de_verdade_e_levam_dano() {
        // Se fossem um tipo à parte, o campo testaria o campo, não o
        // jogo: dano, escudo e destruição precisam passar pelo mesmo
        // caminho de um adversário humano.
        let (mut w, _) = arena_de_treino();
        let alvo = alvos(&w)[0];
        let antes = w.ships[&alvo].3.hull_hp + w.ships[&alvo].3.shield_hp;

        let pos = w.ships[&alvo].0;
        let pid = w.alloc_id();
        w.projectiles.insert(
            pid,
            (
                pos,
                Velocity::default(),
                Projectile {
                    owner_player_id: 1,
                    owner_entity: w.player_ships[&1],
                    damage: 150.0,
                    ttl_remaining: 2.0,
                    radius: 2.0,
                    speed: 100.0,
                    splash_radius: 0.0,
                    visual: 0,
                    charge: 0.0,
                },
            ),
        );
        w.step(1.0 / 30.0);

        let depois = w.ships[&alvo].3.hull_hp + w.ships[&alvo].3.shield_hp;
        assert!(depois < antes, "o alvo deveria levar dano: {antes} -> {depois}");
    }

    #[test]
    fn os_alvos_aparecem_no_snapshot_como_naves() {
        // O travamento e a mira do jogador dependem disso.
        let (mut w, _) = arena_de_treino();
        w.step(1.0 / 30.0);
        let snap = build_snapshot(&w);
        let naves = snap
            .entities
            .iter()
            .filter(|e| e.kind == crate::net::protocol::EntityKind::Ship)
            .count();
        // Três alvos + a nave do jogador.
        assert_eq!(naves, 4);
    }

    #[test]
    fn os_alvos_tem_nome_para_o_jogador_saber_qual_e_qual() {
        let (mut w, _) = arena_de_treino();
        w.step(1.0 / 30.0);
        let snap = build_snapshot(&w);
        let nomes: Vec<String> = snap
            .entities
            .iter()
            .filter_map(|e| e.display_name.clone())
            .collect();
        for k in [
            TrainingKind::Parado,
            TrainingKind::Corredor,
            TrainingKind::Cacador,
        ] {
            assert!(
                nomes.iter().any(|n| n == k.label()),
                "faltou {} em {nomes:?}",
                k.label()
            );
        }
    }

    #[test]
    fn o_alvo_fixo_nao_se_move_ao_longo_do_tempo() {
        let (mut w, _) = arena_de_treino();
        let fixo = *alvos(&w)
            .iter()
            .find(|id| w.ships[id].3.training.as_ref().unwrap().kind == TrainingKind::Parado)
            .unwrap();
        let inicial = w.ships[&fixo].0;
        for _ in 0..(30 * 5) {
            w.step(1.0 / 30.0);
        }
        assert!(dist_sq(w.ships[&fixo].0, inicial).sqrt() < 1.0);
    }

    #[test]
    fn o_alvo_movel_se_move_e_informa_velocidade() {
        // A velocidade informada é o que a mira do jogador antecipa. Se
        // ficasse zerada, o alvo que existe para treinar antecipação
        // seria idêntico ao alvo fixo.
        let (mut w, _) = arena_de_treino();
        let movel = *alvos(&w)
            .iter()
            .find(|id| w.ships[id].3.training.as_ref().unwrap().kind == TrainingKind::Corredor)
            .unwrap();
        let inicial = w.ships[&movel].0;
        let mut maior_vel: f32 = 0.0;
        for _ in 0..(30 * 4) {
            w.step(1.0 / 30.0);
            let v = w.ships[&movel].1;
            maior_vel = maior_vel.max((v.x * v.x + v.y * v.y + v.z * v.z).sqrt());
        }
        assert!(dist_sq(w.ships[&movel].0, inicial).sqrt() > 50.0, "deveria ter se movido");
        assert!(maior_vel > 20.0, "velocidade informada baixa: {maior_vel}");
    }

    #[test]
    fn o_cacador_lanca_torpedo_no_jogador() {
        // É o que torna as quatro defesas testáveis sem outro humano.
        let (mut w, _) = arena_de_treino();
        let mut lancou = false;
        for _ in 0..(30 * 8) {
            w.step(1.0 / 30.0);
            if !w.torpedoes.is_empty() {
                lancou = true;
                break;
            }
        }
        assert!(lancou, "o caçador deveria ter lançado um torpedo");
    }

    #[test]
    fn o_torpedo_do_cacador_persegue_o_jogador() {
        let (mut w, _) = arena_de_treino();
        let eu = w.player_ships[&1];
        for _ in 0..(30 * 8) {
            w.step(1.0 / 30.0);
            if let Some((_, t)) = w.torpedoes.values().next() {
                assert_eq!(t.target, Some(eu), "deveria estar travado em mim");
                return;
            }
        }
        panic!("nenhum torpedo foi lançado");
    }

    #[test]
    fn sem_pedir_treino_nao_ha_alvos() {
        // O campo de provas é opcional: quem entra na arena normal não
        // deve encontrar alvos de treino no caminho.
        let mut w = World::new();
        w.spawn_player_ship(1, "piloto".into());
        assert!(alvos(&w).is_empty());
    }

    #[test]
    fn os_alvos_nao_sao_afetados_por_gravidade() {
        // Alvo de treino tem que ser PREVISÍVEL. Sujeito a gravidade e
        // arrasto, ele sairia de curso e deixaria de medir o que se
        // quer medir.
        let (mut w, _) = arena_de_treino();
        let fixo = *alvos(&w)
            .iter()
            .find(|id| w.ships[id].3.training.as_ref().unwrap().kind == TrainingKind::Parado)
            .unwrap();
        let inicial = w.ships[&fixo].0;
        for _ in 0..(30 * 20) {
            w.step(1.0 / 30.0);
        }
        assert!(
            dist_sq(w.ships[&fixo].0, inicial).sqrt() < 1.0,
            "o alvo fixo derivou"
        );
    }
}
