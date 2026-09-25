//! Classes de piloto: multiplicadores sobre os atributos da nave.
//!
//! O hangar mostrava as classes com números — "Espectro: dano ×1,28,
//! sensores ×1,25, furtividade +15%" — e aplicava esses números às
//! barras do estaleiro. O servidor nunca soube qual classe o jogador
//! escolheu: a escolha mudava o que se via no hangar e nada em combate.
//!
//! A tabela espelha `apps/client/src/data/pilots.ts`; a paridade é
//! conferida por fixture, como a das armas.

/// Multiplicadores de uma classe. `1.0` (e `0.0` no bônus) = neutro.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PilotModifiers {
    pub thrust: f32,
    pub damage: f32,
    pub fire_rate: f32,
    pub shield: f32,
    pub shield_regen: f32,
    pub hull: f32,
    pub sensor_range: f32,
    pub cargo: f32,
    /// Aditivo: a furtividade já é uma fração.
    pub stealth_bonus: f32,
}

pub const NEUTRO: PilotModifiers = PilotModifiers {
    thrust: 1.0,
    damage: 1.0,
    fire_rate: 1.0,
    shield: 1.0,
    shield_regen: 1.0,
    hull: 1.0,
    sensor_range: 1.0,
    cargo: 1.0,
    stealth_bonus: 0.0,
};

/// Ids conhecidos, na ordem do hangar.
pub const CLASSES: [&str; 4] = ["ace", "juggernaut", "ghost", "prospector"];

/// Modificadores da classe; id desconhecido ou vazio é neutro.
///
/// O id vem do cliente, como o loadout. Não há ganho em mentir: cada
/// classe troca uma vantagem por uma desvantagem, e escolher outra é algo
/// que o próprio hangar já permite.
pub fn pilot_modifiers(class_id: &str) -> PilotModifiers {
    match class_id {
        "ace" => PilotModifiers { thrust: 1.18, fire_rate: 1.15, hull: 0.9, shield: 0.92, ..NEUTRO },
        "juggernaut" => {
            PilotModifiers { hull: 1.3, shield: 1.22, damage: 1.08, thrust: 0.85, ..NEUTRO }
        }
        "ghost" => PilotModifiers {
            damage: 1.28,
            sensor_range: 1.25,
            shield: 0.8,
            hull: 0.88,
            stealth_bonus: 0.15,
            ..NEUTRO
        },
        "prospector" => PilotModifiers {
            cargo: 1.6,
            shield_regen: 1.35,
            sensor_range: 1.15,
            damage: 0.82,
            ..NEUTRO
        },
        _ => NEUTRO,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classe_desconhecida_e_neutra() {
        assert_eq!(pilot_modifiers(""), NEUTRO);
        assert_eq!(pilot_modifiers("admin"), NEUTRO);
    }

    #[test]
    fn toda_classe_conhecida_muda_algo() {
        for c in CLASSES {
            assert_ne!(pilot_modifiers(c), NEUTRO, "{c} sem efeito");
        }
    }

    #[test]
    fn nenhuma_classe_so_ganha() {
        // O motivo de confiar no id vindo do cliente: não existe escolha
        // estritamente melhor.
        for c in CLASSES {
            let m = pilot_modifiers(c);
            let perdas = [m.thrust, m.damage, m.fire_rate, m.shield, m.shield_regen, m.hull]
                .iter()
                .filter(|x| **x < 1.0)
                .count();
            assert!(perdas > 0, "{c} não tem desvantagem");
        }
    }
}
