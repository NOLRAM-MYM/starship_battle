//! Consumíveis: cargas limitadas que o jogador leva para a arena.
//!
//! Eram vendidos na loja (`repair_kit`, `shield_cell`) e ficavam ali.
//! Não havia como equipar, não havia como usar, e o servidor sequer
//! conhecia os ids — o jogador gastava créditos num item que não existia
//! dentro do jogo.
//!
//! A diferença para uma skill é a ESCASSEZ: skill tem cooldown e volta
//! sempre; consumível tem carga e acaba. Por isso o efeito é imediato e
//! forte, enquanto o Reparo (skill) cura devagar ao longo de segundos —
//! quem quer a cura agora paga com uma carga.

use serde::{Deserialize, Serialize};

/// O que um consumível faz ao ser usado.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum ConsumableEffect {
    /// Restaura casco imediatamente.
    RepairHull { amount: f32 },
    /// Restaura escudo imediatamente.
    RestoreShield { amount: f32 },
}

/// Perfil de um consumível do catálogo.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ConsumableProfile {
    pub effect: ConsumableEffect,
    /// Segundos de espera entre dois usos, mesmo com cargas sobrando.
    ///
    /// Sem isto, dar dez usos seguidos no mesmo instante transformaria
    /// um inventário grande em invulnerabilidade.
    pub cooldown: f32,
    /// Índice do efeito visual, para o cliente desenhar o certo.
    pub vfx: u8,
}

/// Índices de VFX. Estáveis: o cliente depende desta numeração.
pub const VFX_CONSUMABLE_REPAIR: u8 = 0;
pub const VFX_CONSUMABLE_SHIELD: u8 = 1;

/// Perfil de um `templateId` do catálogo da loja.
///
/// Os ids batem com `apps/api/src/economy/seed.sql` e com
/// `apps/client/src/data/consumables.ts`. Um id desconhecido devolve
/// `None` e é simplesmente ignorado — um cliente adulterado não ganha
/// nada inventando nomes.
pub fn consumable_profile(template_id: &str) -> Option<ConsumableProfile> {
    let p = match template_id {
        "repair_kit" => ConsumableProfile {
            effect: ConsumableEffect::RepairHull { amount: 320.0 },
            cooldown: 6.0,
            vfx: VFX_CONSUMABLE_REPAIR,
        },
        "shield_cell" => ConsumableProfile {
            effect: ConsumableEffect::RestoreShield { amount: 260.0 },
            cooldown: 4.0,
            vfx: VFX_CONSUMABLE_SHIELD,
        },
        _ => return None,
    };
    Some(p)
}

/// Uma carga equipada, como o jogador a leva para a arena.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConsumableSlot {
    pub template_id: String,
    /// Cargas restantes.
    pub charges: u32,
}

/// Consumíveis de uma nave, com o cooldown compartilhado entre slots.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ConsumableBelt {
    pub slots: Vec<ConsumableSlot>,
    /// Espera restante até o próximo uso, em segundos.
    pub cooldown_remaining: f32,
}

/// Resultado de tentar usar um slot.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum UseOutcome {
    /// Aplicou; o chamador executa o efeito.
    Used { effect: ConsumableEffect, vfx: u8 },
    /// Slot vazio, inexistente, ou ainda em espera.
    Rejected,
}

/// Quantos slots o cinto aceita.
///
/// Dois: são as teclas 4 e 5, ao lado das três de skill. Mais que isso
/// exigiria uma segunda fileira no HUD e uma decisão de teclado que não
/// cabe no espaço que sobra.
pub const MAX_SLOTS: usize = 2;

impl ConsumableBelt {
    /// Monta o cinto a partir do que o cliente declarou levar.
    ///
    /// Ids desconhecidos e slots sem carga são descartados aqui, para
    /// que o resto do servidor não precise checar de novo.
    pub fn from_loadout(slots: &[ConsumableSlot]) -> Self {
        let mut belt = Self::default();
        for s in slots {
            if belt.slots.len() >= MAX_SLOTS {
                break;
            }
            if s.charges == 0 || consumable_profile(&s.template_id).is_none() {
                continue;
            }
            belt.slots.push(s.clone());
        }
        belt
    }

    pub fn tick(&mut self, dt: f32) {
        if self.cooldown_remaining > 0.0 {
            self.cooldown_remaining = (self.cooldown_remaining - dt).max(0.0);
        }
    }

    /// Cargas restantes de um slot, para o HUD.
    pub fn charges_at(&self, index: usize) -> u32 {
        self.slots.get(index).map(|s| s.charges).unwrap_or(0)
    }

    /// Usa o slot `index`, consumindo uma carga.
    pub fn use_slot(&mut self, index: usize) -> UseOutcome {
        if self.cooldown_remaining > 0.0 {
            return UseOutcome::Rejected;
        }
        let Some(slot) = self.slots.get_mut(index) else {
            return UseOutcome::Rejected;
        };
        if slot.charges == 0 {
            return UseOutcome::Rejected;
        }
        let Some(profile) = consumable_profile(&slot.template_id) else {
            return UseOutcome::Rejected;
        };
        slot.charges -= 1;
        self.cooldown_remaining = profile.cooldown;
        UseOutcome::Used {
            effect: profile.effect,
            vfx: profile.vfx,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cinto(itens: &[(&str, u32)]) -> ConsumableBelt {
        let slots: Vec<ConsumableSlot> = itens
            .iter()
            .map(|(id, n)| ConsumableSlot {
                template_id: (*id).to_string(),
                charges: *n,
            })
            .collect();
        ConsumableBelt::from_loadout(&slots)
    }

    #[test]
    fn usar_consome_uma_carga() {
        let mut b = cinto(&[("repair_kit", 3)]);
        assert!(matches!(b.use_slot(0), UseOutcome::Used { .. }));
        assert_eq!(b.charges_at(0), 2);
    }

    #[test]
    fn slot_vazio_nao_faz_nada() {
        let mut b = cinto(&[("repair_kit", 1)]);
        assert!(matches!(b.use_slot(0), UseOutcome::Used { .. }));
        b.cooldown_remaining = 0.0;
        assert_eq!(b.use_slot(0), UseOutcome::Rejected);
    }

    #[test]
    fn cooldown_impede_uso_seguido() {
        // Sem espera, um inventário grande viraria invulnerabilidade:
        // dá para gastar todas as cargas no mesmo tick.
        let mut b = cinto(&[("repair_kit", 5)]);
        assert!(matches!(b.use_slot(0), UseOutcome::Used { .. }));
        assert_eq!(b.use_slot(0), UseOutcome::Rejected);
        assert_eq!(b.charges_at(0), 4, "uso recusado não pode gastar carga");
        b.tick(6.0);
        assert!(matches!(b.use_slot(0), UseOutcome::Used { .. }));
    }

    #[test]
    fn indice_fora_da_faixa_e_recusado() {
        let mut b = cinto(&[("repair_kit", 1)]);
        assert_eq!(b.use_slot(9), UseOutcome::Rejected);
    }

    #[test]
    fn id_desconhecido_nao_entra_no_cinto() {
        // Cliente adulterado não ganha nada inventando ids.
        let b = cinto(&[("cura_infinita", 99)]);
        assert!(b.slots.is_empty());
    }

    #[test]
    fn slot_sem_carga_nao_entra() {
        let b = cinto(&[("repair_kit", 0), ("shield_cell", 2)]);
        assert_eq!(b.slots.len(), 1);
        assert_eq!(b.slots[0].template_id, "shield_cell");
    }

    #[test]
    fn respeita_o_limite_de_slots() {
        let b = cinto(&[("repair_kit", 1), ("shield_cell", 1), ("repair_kit", 1)]);
        assert_eq!(b.slots.len(), MAX_SLOTS);
    }

    #[test]
    fn escudo_e_casco_tem_efeitos_diferentes() {
        let mut b = cinto(&[("repair_kit", 1), ("shield_cell", 1)]);
        let a = b.use_slot(0);
        b.cooldown_remaining = 0.0;
        let c = b.use_slot(1);
        assert!(matches!(
            a,
            UseOutcome::Used {
                effect: ConsumableEffect::RepairHull { .. },
                ..
            }
        ));
        assert!(matches!(
            c,
            UseOutcome::Used {
                effect: ConsumableEffect::RestoreShield { .. },
                ..
            }
        ));
    }

    #[test]
    fn cada_consumivel_tem_vfx_proprio() {
        // Se os dois desenhassem igual, o jogador não saberia qual usou.
        let r = consumable_profile("repair_kit").unwrap();
        let s = consumable_profile("shield_cell").unwrap();
        assert_ne!(r.vfx, s.vfx);
    }
}
