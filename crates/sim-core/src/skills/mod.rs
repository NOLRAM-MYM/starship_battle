use std::collections::HashMap;
use serde::{Deserialize, Serialize};

/// Tipos de habilidades ativas disponíveis para as naves.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ActiveSkill {
    /// Aumenta a velocidade máxima e a aceleração temporariamente.
    Dash,
    /// Desativa as armas e o motor de naves inimigas num raio.
    Emp,
    /// Cura a nave ao longo do tempo.
    Repair,
}

impl ActiveSkill {
    /// Retorna o cooldown base da habilidade em segundos.
    pub fn cooldown_secs(&self) -> f32 {
        match self {
            ActiveSkill::Dash => 5.0,
            ActiveSkill::Emp => 15.0,
            ActiveSkill::Repair => 20.0,
        }
    }

    /// Retorna a duração do efeito em segundos (se aplicável).
    pub fn duration_secs(&self) -> f32 {
        match self {
            ActiveSkill::Dash => 2.0,
            ActiveSkill::Emp => 3.0,
            ActiveSkill::Repair => 5.0,
        }
    }

    /// Alcance do efeito sobre OUTRAS naves, em unidades. 0 = só a si.
    ///
    /// O PEM é a única com alcance: as outras duas agem na própria nave.
    pub fn radius(&self) -> f32 {
        match self {
            ActiveSkill::Emp => 220.0,
            _ => 0.0,
        }
    }

    /// Casco curado por segundo enquanto o efeito dura.
    ///
    /// Só o Reparo cura, e devagar de propósito: a cura instantânea é o
    /// papel do consumível, que é escasso. A skill volta sempre, então
    /// ela paga com tempo exposto — cinco segundos sem poder confiar em
    /// escapar é uma decisão de verdade no meio de um combate.
    pub fn heal_per_sec(&self) -> f32 {
        match self {
            ActiveSkill::Repair => 55.0,
            _ => 0.0,
        }
    }
}

/// Estado de uma habilidade em cooldown/ativação.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SkillState {
    /// Tempo restante para poder usar novamente (em segundos).
    pub cooldown_remaining: f32,
    /// Tempo restante do efeito ativo (em segundos). Se > 0, o efeito está rolando.
    pub effect_remaining: f32,
}

/// Gerenciador de habilidades ativas acoplado a uma nave.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct SkillManager {
    pub skills: HashMap<ActiveSkill, SkillState>,
}

impl SkillManager {
    pub fn new() -> Self {
        Self {
            skills: HashMap::new(),
        }
    }

    /// Segundos restantes do EFEITO de uma habilidade (0 se inativa).
    ///
    /// Diferente do cooldown: o efeito é o intervalo em que a skill está
    /// agindo (a cura do Reparo acontecendo), enquanto o cooldown é a
    /// espera até poder usar de novo. Confundir os dois faria a cura
    /// durar os 20s do cooldown em vez dos 5s do efeito.
    pub fn effect_remaining(&self, skill: ActiveSkill) -> f32 {
        self.skills
            .get(&skill)
            .map(|s| s.effect_remaining)
            .unwrap_or(0.0)
    }

    /// Desbloqueia uma habilidade para uso.
    pub fn unlock(&mut self, skill: ActiveSkill) {
        self.skills.entry(skill).or_default();
    }

    /// Tenta usar uma habilidade. Retorna true se foi ativada, false se não tem ou está em cooldown.
    pub fn use_skill(&mut self, skill: ActiveSkill) -> bool {
        if let Some(state) = self.skills.get_mut(&skill) {
            if state.cooldown_remaining <= 0.0 {
                state.cooldown_remaining = skill.cooldown_secs();
                state.effect_remaining = skill.duration_secs();
                return true;
            }
        }
        false
    }

    /// Atualiza os timers baseados no delta time (segundos).
    pub fn tick(&mut self, dt: f32) {
        for state in self.skills.values_mut() {
            state.cooldown_remaining = (state.cooldown_remaining - dt).max(0.0);
            state.effect_remaining = (state.effect_remaining - dt).max(0.0);
        }
    }

    /// Verifica se o efeito de uma habilidade está ativo no momento.
    pub fn is_effect_active(&self, skill: ActiveSkill) -> bool {
        self.skills.get(&skill).map(|s| s.effect_remaining > 0.0).unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skill_use_sets_cooldown_and_effect() {
        let mut manager = SkillManager::new();
        manager.unlock(ActiveSkill::Dash);
        
        // Uso inicial: sucesso
        assert!(manager.use_skill(ActiveSkill::Dash));
        
        // Verifica se timers foram configurados
        let state = manager.skills.get(&ActiveSkill::Dash).unwrap();
        assert_eq!(state.cooldown_remaining, 5.0);
        assert_eq!(state.effect_remaining, 2.0);
        
        // Tentar usar de novo deve falhar (está em cooldown)
        assert!(!manager.use_skill(ActiveSkill::Dash));
    }

    #[test]
    fn skill_tick_decreases_timers() {
        let mut manager = SkillManager::new();
        manager.unlock(ActiveSkill::Dash);
        manager.use_skill(ActiveSkill::Dash);
        
        manager.tick(1.0);
        let state = manager.skills.get(&ActiveSkill::Dash).unwrap();
        assert_eq!(state.cooldown_remaining, 4.0);
        assert_eq!(state.effect_remaining, 1.0);
        assert!(manager.is_effect_active(ActiveSkill::Dash));

        // Passa mais tempo até o efeito expirar
        manager.tick(1.5);
        let state = manager.skills.get(&ActiveSkill::Dash).unwrap();
        assert_eq!(state.cooldown_remaining, 2.5);
        assert_eq!(state.effect_remaining, 0.0);
        assert!(!manager.is_effect_active(ActiveSkill::Dash));
    }

    #[test]
    fn cannot_use_locked_skill() {
        let mut manager = SkillManager::new();
        // Não destravou a habilidade
        assert!(!manager.use_skill(ActiveSkill::Emp));
    }
}