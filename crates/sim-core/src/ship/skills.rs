//! Efeito das skills sobre o combate.
//!
//! A árvore de skills existia só como TEXTO: "+5% weapon damage",
//! "+10% fire rate", "10% dmg bypasses shield" apareciam na interface,
//! o jogador gastava pontos, e nada disso chegava à simulação. O
//! servidor nunca via as skills — o dano saía puro do catálogo de armas.
//!
//! Aqui os nós viram números, e é o SERVIDOR quem os aplica: o cliente
//! manda apenas os ids desbloqueados, exatamente como faz com o
//! loadout. Um cliente que mentisse um id inexistente não ganha nada,
//! porque ids desconhecidos são ignorados.
//!
//! Os ids batem com `apps/client/src/data/skillTree.json`.

use serde::{Deserialize, Serialize};

use super::weapons::WeaponProfile;

/// Modificadores acumulados de combate.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CombatMods {
    /// Multiplicador de dano por projétil.
    pub damage_mult: f32,
    /// Multiplicador de cadência.
    pub fire_rate_mult: f32,
    /// Fração do dano que ignora o escudo e vai direto ao casco (0..1).
    pub shield_pierce: f32,
    /// Multiplicador do tempo de carga. < 1 carrega mais rápido.
    pub charge_time_mult: f32,
}

impl Default for CombatMods {
    fn default() -> Self {
        Self {
            damage_mult: 1.0,
            fire_rate_mult: 1.0,
            shield_pierce: 0.0,
            charge_time_mult: 1.0,
        }
    }
}

/// Efeito de um único nó da árvore.
///
/// Devolve `None` para nós que não tocam no combate (navegação,
/// engenharia): eles continuam existindo na árvore, só não somam aqui.
fn node_effect(node_id: &str) -> Option<CombatMods> {
    let m = match node_id {
        // "Sharpened Aim — +5% weapon damage"
        "combat_t1" => CombatMods {
            damage_mult: 1.05,
            ..Default::default()
        },
        // "Rapid Fire — +10% fire rate"
        "combat_t2" => CombatMods {
            fire_rate_mult: 1.10,
            ..Default::default()
        },
        // "Critical Strike — +15% crit chance"
        //
        // Sem sistema de crítico na simulação, um acerto crítico de 15%
        // seria dano invisível e não determinístico. Vira o valor
        // ESPERADO equivalente (15% de chance de +100% = +15% médio),
        // que é determinístico e replicável — requisito do servidor.
        "combat_t3" => CombatMods {
            damage_mult: 1.15,
            ..Default::default()
        },
        // "Armor Piercing — 10% dmg bypasses shield"
        "combat_t4" => CombatMods {
            shield_pierce: 0.10,
            ..Default::default()
        },
        // "Annihilator — +25% damage vs structures"
        //
        // Só naves e corpos celestes existem hoje; aplicado como dano
        // geral menor (+12%) para não virar um nó morto no fim do ramo.
        "combat_t5" => CombatMods {
            damage_mult: 1.12,
            ..Default::default()
        },
        _ => return None,
    };
    Some(m)
}

/// Soma os nós desbloqueados num único conjunto de modificadores.
///
/// Multiplicadores se compõem por MULTIPLICAÇÃO (dois nós de +10% dão
/// +21%, não +20%): somar deixaria o fim de um ramo longo desproporcional
/// e é a origem clássica de builds degeneradas.
///
/// A perfuração de escudo se acumula por soma, mas com teto em 1.0 —
/// ignorar o escudo inteiro já é o máximo que o efeito pode significar.
pub fn combat_mods(node_ids: &[String]) -> CombatMods {
    let mut acc = CombatMods::default();
    for id in node_ids {
        let Some(m) = node_effect(id) else { continue };
        acc.damage_mult *= m.damage_mult;
        acc.fire_rate_mult *= m.fire_rate_mult;
        acc.charge_time_mult *= m.charge_time_mult;
        acc.shield_pierce = (acc.shield_pierce + m.shield_pierce).min(1.0);
    }
    acc
}

/// Aplica os modificadores ao perfil da arma.
///
/// A `charge_time` menor não é só conveniência: ela muda o ritmo do
/// combate, então passa pelo mesmo caminho de todo o resto — o servidor.
pub fn apply_to_weapon(w: &WeaponProfile, m: &CombatMods) -> WeaponProfile {
    WeaponProfile {
        damage: w.damage * m.damage_mult,
        fire_rate: w.fire_rate * m.fire_rate_mult,
        charge_time: w.charge_time * m.charge_time_mult,
        ..*w
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ship::weapons::weapon_profile;

    #[test]
    fn sem_skills_nao_muda_nada() {
        let m = combat_mods(&[]);
        assert_eq!(m, CombatMods::default());
        let w = weapon_profile("railgun_s").unwrap();
        assert_eq!(apply_to_weapon(&w, &m), w);
    }

    #[test]
    fn no_desconhecido_e_ignorado() {
        // Um cliente que invente ids não pode ganhar nada com isso.
        let m = combat_mods(&["nao_existe".to_string(), "combat_t1".to_string()]);
        assert!((m.damage_mult - 1.05).abs() < 1e-6);
    }

    #[test]
    fn dano_aumenta_com_o_ramo_de_combate() {
        let w = weapon_profile("railgun_s").unwrap();
        let m = combat_mods(&["combat_t1".to_string()]);
        let up = apply_to_weapon(&w, &m);
        assert!(up.damage > w.damage);
        assert!((up.damage - w.damage * 1.05).abs() < 1e-4);
    }

    #[test]
    fn multiplicadores_compoem_por_multiplicacao() {
        // Dois nós de dano: 1.05 * 1.15 = 1.2075, não 1.20.
        let m = combat_mods(&["combat_t1".to_string(), "combat_t3".to_string()]);
        assert!((m.damage_mult - 1.05 * 1.15).abs() < 1e-6);
    }

    #[test]
    fn cadencia_sobe_sem_mexer_no_dano() {
        let w = weapon_profile("plasma_m").unwrap();
        let m = combat_mods(&["combat_t2".to_string()]);
        let up = apply_to_weapon(&w, &m);
        assert!(up.fire_rate > w.fire_rate);
        assert_eq!(up.damage, w.damage);
    }

    #[test]
    fn perfuracao_soma_mas_nao_passa_de_um() {
        let muitos: Vec<String> = std::iter::repeat_n("combat_t4".to_string(), 30).collect();
        let m = combat_mods(&muitos);
        assert!(m.shield_pierce <= 1.0);
        assert!(m.shield_pierce > 0.9);
    }

    #[test]
    fn carga_mais_rapida_preserva_o_multiplicador_de_dano_da_carga() {
        // Reduzir o tempo de carga não pode, por acidente, mudar quanto
        // uma carga cheia rende.
        let w = weapon_profile("lance_singular").unwrap();
        let m = CombatMods {
            charge_time_mult: 0.5,
            ..Default::default()
        };
        let up = apply_to_weapon(&w, &m);
        assert_eq!(up.charge_damage_mult, w.charge_damage_mult);
        assert!((up.charge_time - w.charge_time * 0.5).abs() < 1e-6);
    }

    #[test]
    fn ramos_nao_de_combate_nao_afetam_o_tiro() {
        let m = combat_mods(&["nav_t1".to_string(), "eng_t2".to_string()]);
        assert_eq!(m, CombatMods::default());
    }
}
