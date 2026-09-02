//! Catálogo de armas — a fonte de verdade do DANO no servidor.
//!
//! Antes todo projétil usava `Projectile::default()`: dano 10, cadência
//! fixa, velocidade fixa. O canhão de plasma e o laser em rajada, que a
//! loja vende por preços bem diferentes, atiravam exatamente igual — a
//! escolha de armamento não tinha efeito nenhum no jogo.
//!
//! O catálogo vive aqui, em `sim-core`, e é o SERVIDOR que consulta os
//! números. O cliente só informa qual template equipou; se ele mentisse
//! um dano, o servidor ignoraria — ele nunca envia valores, só ids.

use serde::{Deserialize, Serialize};

/// Família visual do disparo.
///
/// O servidor manda isto no snapshot para que o cliente desenhe o
/// projétil certo. Sem isso todo tiro era a mesma esfera amarela: um
/// laser em rajada e uma Lança Singular — que custa 9.800 e leva 2,5s
/// carregando — apareciam idênticos na tela, e a escolha de armamento
/// não se via em combate.
///
/// É uma FAMÍLIA, não uma arma: armas novas do mesmo tipo reaproveitam
/// a aparência sem mexer no protocolo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WeaponVisual {
    /// Projétil sólido: pequeno, rápido, traçante seco.
    Kinetic,
    /// Feixe: fino, muito alongado, brilho puro.
    Laser,
    /// Bola de plasma: gorda, lenta, com halo.
    Plasma,
    /// Lança: dardo enorme, com cauda longa.
    Lance,
}

impl WeaponVisual {
    /// Índice no fio. Estável — o cliente depende desta ordem.
    pub fn to_index(self) -> u8 {
        match self {
            WeaponVisual::Kinetic => 0,
            WeaponVisual::Laser => 1,
            WeaponVisual::Plasma => 2,
            WeaponVisual::Lance => 3,
        }
    }
}

/// Perfil balístico de uma arma.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct WeaponProfile {
    /// Dano por projétil, antes de escudo.
    pub damage: f32,
    /// Disparos por segundo.
    pub fire_rate: f32,
    /// Velocidade do projétil (m/s).
    pub speed: f32,
    /// Raio de colisão do projétil.
    pub radius: f32,
    /// Tempo de vida (s) — define o alcance efetivo.
    pub ttl: f32,
    /// Raio de dano em área. 0 = impacto direto apenas.
    pub splash_radius: f32,
    /// Segundos de carga para atingir o disparo máximo.
    ///
    /// 0 = a arma não carrega (só rajada). Armas de cadência alta não
    /// carregam de propósito: o trade-off delas já é volume de fogo.
    pub charge_time: f32,
    /// Multiplicador de dano com carga cheia.
    pub charge_damage_mult: f32,
    /// Multiplicador de velocidade do projétil com carga cheia.
    pub charge_speed_mult: f32,
    /// Como o cliente desenha o projétil desta arma.
    pub visual: WeaponVisual,
}

/// Efeito de uma carga sobre o disparo.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ChargedShot {
    pub damage: f32,
    pub speed: f32,
    pub radius: f32,
    pub splash_radius: f32,
    pub ttl: f32,
    /// 0..1 — quanto da carga foi aproveitado. Alimenta o VFX.
    pub charge: f32,
}

impl WeaponProfile {
    /// Aplica `held_secs` de carga ao disparo.
    ///
    /// A escala é QUADRÁTICA: metade do tempo de carga dá bem menos que
    /// metade do bônus. Sem isso, dar toques curtos seria mais eficiente
    /// em dano/segundo que carregar de verdade, e a mecânica não teria
    /// razão de existir.
    pub fn charged(&self, held_secs: f32) -> ChargedShot {
        if self.charge_time <= 0.0 {
            return ChargedShot {
                damage: self.damage,
                speed: self.speed,
                radius: self.radius,
                splash_radius: self.splash_radius,
                ttl: self.ttl,
                charge: 0.0,
            };
        }
        let t = (held_secs / self.charge_time).clamp(0.0, 1.0);
        let k = t * t;
        let dmg_mult = 1.0 + (self.charge_damage_mult - 1.0) * k;
        let spd_mult = 1.0 + (self.charge_speed_mult - 1.0) * k;
        ChargedShot {
            damage: self.damage * dmg_mult,
            speed: self.speed * spd_mult,
            // Projétil carregado é maior: acerta mais fácil, o que
            // compensa o tempo parado carregando.
            radius: self.radius * (1.0 + 0.9 * k),
            splash_radius: self.splash_radius * (1.0 + 1.2 * k),
            // Mais rápido e vivo por mais tempo = alcance bem maior.
            ttl: self.ttl * (1.0 + 0.45 * k),
            charge: t,
        }
    }

    /// Cooldown após um disparo com `held_secs` de carga.
    ///
    /// Carregar não é grátis: o tiro cheio custa uma pausa maior. É o
    /// que equilibra "um tiro forte" contra "vários tiros fracos".
    pub fn cooldown_after_charge(&self, held_secs: f32) -> f32 {
        let base = self.cooldown();
        if self.charge_time <= 0.0 {
            return base;
        }
        let t = (held_secs / self.charge_time).clamp(0.0, 1.0);
        base * (1.0 + 0.8 * t)
    }
}

impl WeaponProfile {
    /// Intervalo entre disparos, em segundos.
    pub fn cooldown(&self) -> f32 {
        if self.fire_rate <= 0.0 {
            return 1.0;
        }
        1.0 / self.fire_rate
    }

    /// Alcance efetivo = velocidade x tempo de vida.
    pub fn range(&self) -> f32 {
        self.speed * self.ttl
    }

    /// DPS teórico contra alvo parado, sem escudo.
    pub fn dps(&self) -> f32 {
        self.damage * self.fire_rate
    }
}

/// Arma padrão de quem não equipou nada.
///
/// Fraca de propósito: voar desarmado tem que ser uma desvantagem real,
/// mas não deixar o jogador sem nenhuma resposta.
pub const DEFAULT_WEAPON: WeaponProfile = WeaponProfile {
    damage: 8.0,
    fire_rate: 2.0,
    speed: 100.0,
    radius: 0.5,
    ttl: 3.0,
    splash_radius: 0.0,
    charge_time: 0.0,
    charge_damage_mult: 1.0,
    charge_speed_mult: 1.0,
    visual: WeaponVisual::Kinetic,
};

/// Perfil de um `templateId` do catálogo da loja.
///
/// Os ids batem com `apps/client/src/ui/componentLibrary.ts` e com
/// `apps/api/src/economy/seed.sql`. Se um lado mudar sem os outros, a
/// arma cai no padrão em vez de quebrar.
pub fn weapon_profile(template_id: &str) -> Option<WeaponProfile> {
    let p = match template_id {
        // Cinético leve: cadência alta, dano baixo, projétil rápido.
        "railgun_s" => WeaponProfile {
            damage: 24.0,
            fire_rate: 3.2,
            speed: 190.0,
            radius: 0.5,
            ttl: 2.6,
            splash_radius: 0.0,
            // Carga curta e modesta: o forte dela é a cadência.
            charge_time: 0.9,
            charge_damage_mult: 2.6,
            charge_speed_mult: 1.5,
            visual: WeaponVisual::Kinetic,
        },
        // Laser em rajada: derrete escudo, quase inofensivo ao casco.
        "laser_burst" => WeaponProfile {
            damage: 12.0,
            fire_rate: 6.5,
            speed: 240.0,
            radius: 0.35,
            ttl: 1.8,
            splash_radius: 0.0,
            // NÃO carrega: a identidade dela é volume de fogo.
            charge_time: 0.0,
            charge_damage_mult: 1.0,
            charge_speed_mult: 1.0,
            visual: WeaponVisual::Laser,
        },
        // Plasma: salvas pesadas e lentas, com respingo.
        "plasma_m" => WeaponProfile {
            damage: 72.0,
            fire_rate: 1.1,
            speed: 120.0,
            radius: 1.2,
            ttl: 3.4,
            splash_radius: 14.0,
            // Carga longa que triplica o dano e dobra o respingo.
            charge_time: 1.6,
            charge_damage_mult: 3.0,
            charge_speed_mult: 1.35,
            visual: WeaponVisual::Plasma,
        },
        // Lança singular: um tiro, uma decisão.
        "lance_singular" => WeaponProfile {
            damage: 210.0,
            fire_rate: 0.35,
            speed: 320.0,
            radius: 1.6,
            ttl: 4.0,
            splash_radius: 26.0,
            // A arma de carga por excelência: 2.5s para um tiro que
            // decide o combate.
            charge_time: 2.5,
            charge_damage_mult: 3.4,
            charge_speed_mult: 1.6,
            visual: WeaponVisual::Lance,
        },
        _ => return None,
    };
    Some(p)
}

/// Bônus defensivos de um componente de escudo/casco.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct DefenseProfile {
    pub shield: f32,
    pub shield_regen: f32,
    pub hull: f32,
}

/// Perfil defensivo de um `templateId`, se houver.
pub fn defense_profile(template_id: &str) -> Option<DefenseProfile> {
    let p = match template_id {
        "shield_bio" => DefenseProfile { shield: 260.0, shield_regen: 9.0, hull: 0.0 },
        "shield_phase" => DefenseProfile { shield: 180.0, shield_regen: 26.0, hull: 0.0 },
        "shield_bulwark" => DefenseProfile { shield: 620.0, shield_regen: 4.0, hull: 120.0 },
        "cargo_hauler" => DefenseProfile { shield: 0.0, shield_regen: 0.0, hull: 60.0 },
        "cloak_umbra" => DefenseProfile { shield: -80.0, shield_regen: 0.0, hull: 0.0 },
        _ => return None,
    };
    Some(p)
}

/// Empuxo que um componente de motor fornece.
pub fn engine_thrust(template_id: &str) -> Option<f32> {
    let t = match template_id {
        "engine_mk1" => 60.0,
        "engine_mk3" => 145.0,
        "engine_ion" => 170.0,
        "engine_void" => 260.0,
        _ => return None,
    };
    Some(t)
}

/// Massa de um componente, em toneladas.
pub fn component_mass(template_id: &str) -> f32 {
    match template_id {
        "engine_mk1" => 10.0,
        "engine_mk3" => 25.0,
        "engine_ion" => 16.0,
        "engine_void" => 34.0,
        "railgun_s" => 20.0,
        "laser_burst" => 26.0,
        "plasma_m" => 45.0,
        "lance_singular" => 62.0,
        "shield_bio" => 15.0,
        "shield_phase" => 12.0,
        "shield_bulwark" => 38.0,
        "sensor_array" => 5.0,
        "sensor_deep" => 9.0,
        "cargo_x2" => 8.0,
        "cargo_hauler" => 30.0,
        "cloak_lvl1" => 12.0,
        "cloak_umbra" => 22.0,
        _ => 0.0,
    }
}

/// Atributos de combate derivados de um loadout completo.
#[derive(Debug, Clone, PartialEq)]
pub struct LoadoutStats {
    pub weapon: WeaponProfile,
    pub shield_max: f32,
    pub shield_regen: f32,
    pub hull_max: f32,
    pub thrust: f32,
    pub mass: f32,
}

/// Casco vazio: os valores de uma nave sem nenhum componente.
pub const BASE_HULL_HP: f32 = 800.0;
pub const BASE_MASS: f32 = 1000.0;

/// Empuxo dos propulsores de manobra do próprio casco.
///
/// Sem isso, uma nave sem motor equipado ficava com `thrust = 0` e
/// literalmente não saía do lugar — um soft-lock dentro da arena, sem
/// nem como voltar ao hangar voando. O casco sempre tem o mínimo para
/// manobrar; motores de verdade somam por cima.
pub const BASE_THRUST: f32 = 25.0;

/// Resolve um loadout (lista de `templateId`) nos atributos de combate.
///
/// Regras deliberadas:
///  - **a PRIMEIRA arma da lista é a primária**, e não a de maior DPS.
///    A lista chega em ordem de slot, então quem decide é o jogador no
///    estaleiro. Escolher por DPS parecia natural mas invertia a
///    intenção: a Lança Singular (210 de dano, 0.35/s = 73.5 DPS)
///    perderia para o Canhão Linear comum (24 x 3.2 = 76.8 DPS), e a
///    arma lendária que o jogador comprou seria ignorada;
///  - armas não somam: duas armas não viram um projétil com o dano das
///    duas, o que não corresponderia a nada visível na nave;
///  - ids desconhecidos são ignorados, não derrubam a nave;
///  - escudo nunca fica negativo (o Manto Umbra tem penalidade).
pub fn resolve_loadout(template_ids: &[String]) -> LoadoutStats {
    let mut stats = LoadoutStats {
        weapon: DEFAULT_WEAPON,
        shield_max: 0.0,
        shield_regen: 0.0,
        hull_max: BASE_HULL_HP,
        thrust: BASE_THRUST,
        mass: BASE_MASS,
    };
    let mut achou_arma = false;

    for id in template_ids {
        stats.mass += component_mass(id);

        if let Some(w) = weapon_profile(id) {
            // Primeira arma encontrada = primária (ordem de slot).
            if !achou_arma {
                stats.weapon = w;
                achou_arma = true;
            }
        }
        if let Some(d) = defense_profile(id) {
            stats.shield_max += d.shield;
            stats.shield_regen += d.shield_regen;
            stats.hull_max += d.hull;
        }
        if let Some(t) = engine_thrust(id) {
            stats.thrust += t;
        }
    }

    stats.shield_max = stats.shield_max.max(0.0);
    stats.hull_max = stats.hull_max.max(1.0);
    stats
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn arma_desconhecida_cai_no_padrao() {
        assert!(weapon_profile("nao_existe").is_none());
        let s = resolve_loadout(&ids(&["nao_existe"]));
        assert_eq!(s.weapon, DEFAULT_WEAPON);
    }

    #[test]
    fn cada_arma_tem_perfil_proprio() {
        // O ponto da mudança: as armas precisam ser DIFERENTES.
        let railgun = weapon_profile("railgun_s").unwrap();
        let laser = weapon_profile("laser_burst").unwrap();
        let plasma = weapon_profile("plasma_m").unwrap();
        let lanca = weapon_profile("lance_singular").unwrap();

        assert!(laser.fire_rate > railgun.fire_rate);
        assert!(plasma.damage > railgun.damage);
        assert!(lanca.damage > plasma.damage);
        assert!(lanca.cooldown() > plasma.cooldown());
        // Só as pesadas têm respingo.
        assert_eq!(railgun.splash_radius, 0.0);
        assert!(plasma.splash_radius > 0.0);
    }

    #[test]
    fn cooldown_e_o_inverso_da_cadencia() {
        let w = weapon_profile("railgun_s").unwrap();
        assert!((w.cooldown() - 1.0 / 3.2).abs() < 1e-6);
    }

    #[test]
    fn cadencia_zero_nao_divide_por_zero() {
        let w = WeaponProfile { fire_rate: 0.0, ..DEFAULT_WEAPON };
        assert!(w.cooldown().is_finite());
        assert!(w.cooldown() > 0.0);
    }

    #[test]
    fn a_primeira_arma_da_lista_e_a_primaria() {
        // Quem decide é o jogador pela ordem dos slots, não o DPS.
        let a = resolve_loadout(&ids(&["lance_singular", "railgun_s"]));
        assert_eq!(a.weapon, weapon_profile("lance_singular").unwrap());

        let b = resolve_loadout(&ids(&["railgun_s", "lance_singular"]));
        assert_eq!(b.weapon, weapon_profile("railgun_s").unwrap());
    }

    #[test]
    fn armas_nao_somam_dano() {
        let s = resolve_loadout(&ids(&["railgun_s", "lance_singular"]));
        assert!(s.weapon.damage < 24.0 + 210.0);
    }

    #[test]
    fn a_lendaria_nao_perde_por_dps_menor() {
        // Regressão do critério antigo: a Lança tem DPS MENOR que o
        // Canhão Linear (73.5 vs 76.8). Escolher por DPS a descartaria.
        let lanca = weapon_profile("lance_singular").unwrap();
        let railgun = weapon_profile("railgun_s").unwrap();
        assert!(lanca.dps() < railgun.dps(), "premissa do teste mudou");

        let s = resolve_loadout(&ids(&["lance_singular"]));
        assert_eq!(s.weapon, lanca);
    }

    #[test]
    fn defesas_somam() {
        let s = resolve_loadout(&ids(&["shield_bio", "shield_phase"]));
        assert_eq!(s.shield_max, 260.0 + 180.0);
        assert_eq!(s.shield_regen, 9.0 + 26.0);
    }

    #[test]
    fn escudo_nao_fica_negativo() {
        // O Manto Umbra tem -80 de escudo; sozinho não pode gerar
        // capacidade negativa.
        let s = resolve_loadout(&ids(&["cloak_umbra"]));
        assert_eq!(s.shield_max, 0.0);
    }

    #[test]
    fn motores_somam_empuxo_e_massa() {
        let s = resolve_loadout(&ids(&["engine_mk1", "engine_mk1"]));
        assert_eq!(s.thrust, BASE_THRUST + 120.0);
        assert_eq!(s.mass, BASE_MASS + 20.0);
    }

    #[test]
    fn nave_sem_motor_ainda_manobra() {
        // Empuxo zero seria um soft-lock: a nave não sairia do lugar
        // nem para voltar ao hangar.
        let s = resolve_loadout(&ids(&["railgun_s"]));
        assert!(s.thrust > 0.0, "casco precisa de propulsor de manobra");
        assert_eq!(s.thrust, BASE_THRUST);
    }

    #[test]
    fn loadout_vazio_e_utilizavel() {
        let s = resolve_loadout(&[]);
        assert_eq!(s.weapon, DEFAULT_WEAPON);
        assert_eq!(s.hull_max, BASE_HULL_HP);
        assert_eq!(s.thrust, BASE_THRUST);
    }

    #[test]
    fn carga_cheia_bate_muito_mais_que_um_toque() {
        let w = weapon_profile("plasma_m").unwrap();
        let toque = w.charged(0.0);
        let cheio = w.charged(w.charge_time);
        assert!(cheio.damage > toque.damage * 2.5, "toque={} cheio={}", toque.damage, cheio.damage);
        assert!(cheio.speed > toque.speed);
        assert!(cheio.radius > toque.radius);
        assert_eq!(cheio.charge, 1.0);
    }

    #[test]
    fn carga_e_quadratica_nao_linear() {
        // Se fosse linear, dar toques curtos renderia o mesmo dano por
        // segundo que carregar — e carregar não teria motivo de existir.
        let w = weapon_profile("plasma_m").unwrap();
        let meio = w.charged(w.charge_time * 0.5).damage;
        let cheio = w.charged(w.charge_time).damage;
        let toque = w.charged(0.0).damage;
        let ganho_meio = meio - toque;
        let ganho_cheio = cheio - toque;
        assert!(ganho_meio < ganho_cheio * 0.4, "meio={ganho_meio} cheio={ganho_cheio}");
    }

    #[test]
    fn carga_satura_no_maximo() {
        let w = weapon_profile("lance_singular").unwrap();
        let cheio = w.charged(w.charge_time);
        let exagerado = w.charged(w.charge_time * 10.0);
        assert_eq!(cheio.damage, exagerado.damage);
    }

    #[test]
    fn arma_de_rajada_nao_carrega() {
        // O laser é definido por cadência; deixá-lo carregar apagaria a
        // diferença entre as armas.
        let w = weapon_profile("laser_burst").unwrap();
        assert_eq!(w.charge_time, 0.0);
        assert_eq!(w.charged(5.0).damage, w.damage);
        assert_eq!(w.charged(5.0).charge, 0.0);
    }

    #[test]
    fn carregar_custa_cooldown_maior() {
        let w = weapon_profile("plasma_m").unwrap();
        assert!(w.cooldown_after_charge(w.charge_time) > w.cooldown_after_charge(0.0));
    }

    #[test]
    fn tiro_carregado_nao_supera_a_soma_de_tiros_rapidos_em_dps() {
        // Equilíbrio: carregar tem que ser uma ESCOLHA (alfa alto,
        // arriscado), não a opção sempre melhor.
        let w = weapon_profile("plasma_m").unwrap();
        let cheio = w.charged(w.charge_time);
        let tempo_cheio = w.charge_time + w.cooldown_after_charge(w.charge_time);
        let dps_carregado = cheio.damage / tempo_cheio;
        let dps_rajada = w.damage / w.cooldown();
        assert!(
            dps_carregado < dps_rajada,
            "carregado={dps_carregado} rajada={dps_rajada} — carregar não pode dominar"
        );
    }

    #[test]
    fn carga_negativa_e_tratada_como_zero() {
        let w = weapon_profile("plasma_m").unwrap();
        assert_eq!(w.charged(-1.0).damage, w.charged(0.0).damage);
    }

    #[test]
    fn alcance_cresce_com_velocidade_e_ttl() {
        let r = weapon_profile("railgun_s").unwrap();
        let l = weapon_profile("lance_singular").unwrap();
        assert!(l.range() > r.range());
    }
}
