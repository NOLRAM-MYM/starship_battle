//! Times e relação entre naves.
//!
//! Antes disto não existia noção de aliado: o cliente marcava TODO
//! contato como hostil, o retículo pintava todo mundo da mesma cor, e o
//! fogo amigo era decidido comparando `owner_player_id` espalhado por
//! vários pontos da simulação. Não havia como um esquadrão voar junto.
//!
//! O modelo é deliberadamente pequeno: um número por nave. Duas naves
//! com o MESMO time não-zero são aliadas; qualquer outra combinação é
//! hostil. Não há níveis intermediários porque não há decisão de jogo
//! que dependa deles — o que o piloto precisa saber é se pode atirar.

use serde::{Deserialize, Serialize};

/// Identificador de time.
///
/// `u32` e não `u8` porque o time padrão de um jogador é o próprio
/// `player_id`: isso dá combate livre (cada um por si) sem nenhuma
/// configuração, e um `u8` estouraria com 256 jogadores no shard.
pub type TeamId = u32;

/// "Sem time": hostil a todos, inclusive a outros sem time.
///
/// É o valor de NPCs, destroços e alvos de treino. Coincide com o
/// sentinela de `owner_player_id` de propósito — os dois querem dizer a
/// mesma coisa: não pertence a nenhum jogador.
pub const TEAM_NONE: TeamId = 0;

/// Relação entre duas naves, do ponto de vista de quem olha.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Relation {
    /// Mesmo time: não se pode atirar, e a interface o marca como apoio.
    Friendly,
    /// Alvo legítimo.
    Hostile,
}

/// Relação entre dois times.
///
/// A regra do `TEAM_NONE` é a parte que importa: dois alvos de treino
/// não viram aliados só por ambos serem "sem dono". Tratá-los como
/// aliados faria o fogo amigo bloquear tiros entre NPCs e, pior, entre
/// um NPC e o primeiro jogador, se o id dele coincidisse com o
/// sentinela.
pub fn relation(a: TeamId, b: TeamId) -> Relation {
    if a != TEAM_NONE && a == b {
        Relation::Friendly
    } else {
        Relation::Hostile
    }
}

/// `true` quando `atacante` pode causar dano em `alvo`.
///
/// Uma nave nunca fere a si mesma nem a um aliado. Concentrar a regra
/// aqui é o ponto: espalhada pelo laço de colisão, cada arma nova
/// precisava reimplementá-la, e bastava esquecer uma para o fogo amigo
/// voltar em silêncio.
pub fn can_damage(atacante: TeamId, alvo: TeamId) -> bool {
    relation(atacante, alvo) == Relation::Hostile
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mesmo_time_e_aliado() {
        assert_eq!(relation(7, 7), Relation::Friendly);
    }

    #[test]
    fn times_diferentes_sao_hostis() {
        assert_eq!(relation(7, 8), Relation::Hostile);
    }

    #[test]
    fn sem_time_e_hostil_a_todos() {
        assert_eq!(relation(TEAM_NONE, 5), Relation::Hostile);
        assert_eq!(relation(5, TEAM_NONE), Relation::Hostile);
    }

    #[test]
    fn dois_sem_time_nao_viram_aliados() {
        // O caso que a regra existe para impedir: dois alvos de treino
        // não são aliados só por ambos serem "sem dono". Se fossem, o
        // fogo amigo bloquearia tiros entre eles — e, se o id de um
        // jogador coincidisse com o sentinela, entre ele e os NPCs.
        assert_eq!(relation(TEAM_NONE, TEAM_NONE), Relation::Hostile);
    }

    #[test]
    fn nao_se_pode_ferir_aliado() {
        assert!(!can_damage(3, 3));
        assert!(can_damage(3, 4));
    }

    #[test]
    fn npc_sempre_pode_ser_ferido() {
        assert!(can_damage(1, TEAM_NONE));
    }
}
