//! Campo de provas: adversários de teste com comportamento previsível.
//!
//! Existe porque verificar as mecânicas de combate exigia dois jogadores
//! humanos coordenados, e mesmo assim o encontro era aleatório — dá para
//! passar minutos sem conseguir pôr um alvo no campo de visão. Sem um
//! adversário confiável, mira, torpedo e defesas só podiam ser testados
//! em teste unitário, nunca no jogo montado.
//!
//! Cada alvo exercita UMA coisa, e o comportamento é determinístico de
//! propósito: um alvo que se move de forma imprevisível não serve para
//! aferir nada. Quem quer imprevisibilidade joga contra gente.
//!
//! - `Parado`    — mira em repouso, dano por arma, tiro carregado.
//! - `Corredor`  — antecipação: cruza na lateral, que é o caso difícil.
//! - `Cacador`   — as quatro defesas: aproxima e lança torpedos.

use serde::{Deserialize, Serialize};

/// O que um adversário de treino faz.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TrainingKind {
    /// Fica onde nasceu. Alvo de calibração.
    Parado,
    /// Cruza a lateral em vaivém, a velocidade constante.
    Corredor,
    /// Aproxima-se e lança torpedos.
    Cacador,
}

impl TrainingKind {
    /// Nome mostrado no jogo.
    pub fn label(self) -> &'static str {
        match self {
            TrainingKind::Parado => "Alvo Fixo",
            TrainingKind::Corredor => "Alvo Móvel",
            TrainingKind::Cacador => "Caçador",
        }
    }

    /// A que distância do jogador o alvo nasce.
    ///
    /// Escalonadas: o alvo fixo perto para calibrar, o corredor longe o
    /// bastante para que a antecipação importe de verdade, e o caçador
    /// no meio, dentro do alcance de travamento do torpedo dele.
    pub fn spawn_distance(self) -> f32 {
        match self {
            TrainingKind::Parado => 260.0,
            TrainingKind::Corredor => 520.0,
            TrainingKind::Cacador => 400.0,
        }
    }

    /// Casco. O caçador aguenta mais para dar tempo de testar as defesas.
    pub fn hull(self) -> f32 {
        match self {
            TrainingKind::Parado => 900.0,
            TrainingKind::Corredor => 700.0,
            TrainingKind::Cacador => 1400.0,
        }
    }
}

/// Estado de um adversário de treino.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TrainingDummy {
    pub kind: TrainingKind,
    /// Onde nasceu — o vaivém do corredor oscila em torno disto.
    pub anchor: [f32; 3],
    /// Segundos desde que nasceu, para o movimento ser função do tempo.
    pub age: f32,
    /// Espera até o próximo torpedo, no caso do caçador.
    pub launch_cooldown: f32,
}

/// O que o adversário quer fazer neste tick.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TrainingAction {
    /// Posição para onde ele deve ir.
    pub position: [f32; 3],
    /// Velocidade correspondente, para o cliente interpolar e para a
    /// solução de mira ter o que antecipar.
    pub velocity: [f32; 3],
    /// `true` quando deve lançar um torpedo no jogador neste tick.
    pub launch_torpedo: bool,
}

/// Amplitude do vaivém do corredor, em unidades.
///
/// Larga o bastante para que o ponto de mira saia visivelmente do alvo:
/// com uma amplitude pequena, a antecipação caberia dentro do próprio
/// casco e o exercício não ensinaria nada.
const CORREDOR_AMPLITUDE: f32 = 240.0;
/// Período do vaivém, em segundos.
const CORREDOR_PERIODO: f32 = 9.0;
/// Espera entre torpedos do caçador.
///
/// Folgada: o jogador precisa de tempo para tentar CADA defesa contra o
/// mesmo torpedo antes do próximo chegar.
pub const CACADOR_INTERVALO: f32 = 12.0;

fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn len(a: [f32; 3]) -> f32 {
    (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]).sqrt()
}

impl TrainingDummy {
    pub fn new(kind: TrainingKind, anchor: [f32; 3]) -> Self {
        Self {
            kind,
            anchor,
            age: 0.0,
            // O primeiro torpedo demora menos: o jogador não deveria
            // esperar 12s parado para começar a testar.
            launch_cooldown: 3.0,
        }
    }

    /// Avança o comportamento e devolve o que fazer.
    pub fn step(&mut self, dt: f32, player_pos: [f32; 3]) -> TrainingAction {
        self.age += dt;
        if self.launch_cooldown > 0.0 {
            self.launch_cooldown -= dt;
        }

        match self.kind {
            TrainingKind::Parado => TrainingAction {
                position: self.anchor,
                velocity: [0.0, 0.0, 0.0],
                launch_torpedo: false,
            },

            TrainingKind::Corredor => {
                // Vaivém senoidal no eixo X em torno da âncora. A
                // velocidade é a derivada exata, e não uma diferença
                // entre quadros: assim a mira antecipa o movimento REAL
                // em vez de um valor defasado de um tick.
                let w = std::f32::consts::TAU / CORREDOR_PERIODO;
                let fase = w * self.age;
                let dx = CORREDOR_AMPLITUDE * fase.sin();
                let vx = CORREDOR_AMPLITUDE * w * fase.cos();
                TrainingAction {
                    position: [self.anchor[0] + dx, self.anchor[1], self.anchor[2]],
                    velocity: [vx, 0.0, 0.0],
                    launch_torpedo: false,
                }
            }

            TrainingKind::Cacador => {
                // Mantém distância de tiro em vez de colar no jogador:
                // colado, ele viraria um alvo trivial e os torpedos não
                // teriam espaço para perseguir.
                const DISTANCIA_IDEAL: f32 = 380.0;
                let para_alvo = sub(player_pos, self.anchor);
                let d = len(para_alvo);
                let (pos, vel) = if d > 1.0 {
                    let dir = [para_alvo[0] / d, para_alvo[1] / d, para_alvo[2] / d];
                    // Aproxima ou recua até a distância ideal.
                    let ajuste = (d - DISTANCIA_IDEAL).clamp(-60.0, 60.0);
                    let passo = ajuste * dt * 0.5;
                    let novo = [
                        self.anchor[0] + dir[0] * passo,
                        self.anchor[1] + dir[1] * passo,
                        self.anchor[2] + dir[2] * passo,
                    ];
                    let v = [
                        dir[0] * ajuste * 0.5,
                        dir[1] * ajuste * 0.5,
                        dir[2] * ajuste * 0.5,
                    ];
                    (novo, v)
                } else {
                    (self.anchor, [0.0, 0.0, 0.0])
                };
                self.anchor = pos;

                let lancar = self.launch_cooldown <= 0.0;
                if lancar {
                    self.launch_cooldown = CACADOR_INTERVALO;
                }
                TrainingAction {
                    position: pos,
                    velocity: vel,
                    launch_torpedo: lancar,
                }
            }
        }
    }
}

/// Os adversários que compõem o campo de provas.
///
/// Três, e não um: cada mecânica que se quer aferir precisa de uma
/// situação diferente, e trocar de alvo é mais rápido que reconfigurar
/// um só.
pub fn training_range() -> Vec<TrainingKind> {
    vec![
        TrainingKind::Parado,
        TrainingKind::Corredor,
        TrainingKind::Cacador,
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn o_campo_tem_um_alvo_para_cada_mecanica() {
        let r = training_range();
        assert!(r.contains(&TrainingKind::Parado), "mira em repouso");
        assert!(r.contains(&TrainingKind::Corredor), "antecipação");
        assert!(r.contains(&TrainingKind::Cacador), "defesas contra torpedo");
    }

    #[test]
    fn o_alvo_fixo_nao_sai_do_lugar() {
        // É o alvo de calibração: se ele se mexesse, não daria para
        // separar erro de mira de erro de antecipação.
        let mut d = TrainingDummy::new(TrainingKind::Parado, [10.0, 20.0, 30.0]);
        for _ in 0..100 {
            let a = d.step(1.0 / 30.0, [0.0, 0.0, 0.0]);
            assert_eq!(a.position, [10.0, 20.0, 30.0]);
            assert_eq!(a.velocity, [0.0, 0.0, 0.0]);
            assert!(!a.launch_torpedo);
        }
    }

    #[test]
    fn o_corredor_cruza_de_um_lado_ao_outro() {
        let mut d = TrainingDummy::new(TrainingKind::Corredor, [0.0, 0.0, 500.0]);
        let mut min_x = f32::MAX;
        let mut max_x = f32::MIN;
        for _ in 0..(30 * 10) {
            let a = d.step(1.0 / 30.0, [0.0, 0.0, 0.0]);
            min_x = min_x.min(a.position[0]);
            max_x = max_x.max(a.position[0]);
        }
        // Percorre praticamente a amplitude inteira nos dois sentidos.
        assert!(max_x > CORREDOR_AMPLITUDE * 0.9, "max_x={max_x}");
        assert!(min_x < -CORREDOR_AMPLITUDE * 0.9, "min_x={min_x}");
    }

    #[test]
    fn a_velocidade_do_corredor_e_a_derivada_da_posicao() {
        // Se a velocidade não bater com o movimento real, a mira
        // antecipa errado — e o alvo que existe para TREINAR antecipação
        // passaria a ensinar o erro.
        let mut d = TrainingDummy::new(TrainingKind::Corredor, [0.0, 0.0, 500.0]);
        let dt = 1.0 / 240.0;
        let a = d.step(dt, [0.0; 3]);
        let b = d.step(dt, [0.0; 3]);
        let dx_medido = (b.position[0] - a.position[0]) / dt;
        assert!(
            (dx_medido - a.velocity[0]).abs() < 6.0,
            "derivada {} vs velocidade informada {}",
            dx_medido,
            a.velocity[0]
        );
    }

    #[test]
    fn o_corredor_nao_lanca_torpedo() {
        let mut d = TrainingDummy::new(TrainingKind::Corredor, [0.0, 0.0, 500.0]);
        for _ in 0..(30 * 30) {
            assert!(!d.step(1.0 / 30.0, [0.0; 3]).launch_torpedo);
        }
    }

    #[test]
    fn o_cacador_lanca_o_primeiro_torpedo_rapido() {
        // Esperar 12s parado antes de poder testar qualquer defesa
        // tornaria o campo de provas inútil na prática.
        let mut d = TrainingDummy::new(TrainingKind::Cacador, [0.0, 0.0, 400.0]);
        let mut lancou_em = None;
        for i in 0..(30 * 6) {
            if d.step(1.0 / 30.0, [0.0; 3]).launch_torpedo {
                lancou_em = Some(i as f32 / 30.0);
                break;
            }
        }
        let t = lancou_em.expect("deveria ter lançado");
        assert!(t < 4.0, "primeiro torpedo demorou {t}s");
    }

    #[test]
    fn o_cacador_espera_entre_torpedos() {
        // O jogador precisa de tempo para tentar CADA defesa contra o
        // mesmo torpedo antes do próximo chegar.
        let mut d = TrainingDummy::new(TrainingKind::Cacador, [0.0, 0.0, 400.0]);
        let mut lancamentos = Vec::new();
        for i in 0..(30 * 40) {
            if d.step(1.0 / 30.0, [0.0; 3]).launch_torpedo {
                lancamentos.push(i as f32 / 30.0);
            }
        }
        assert!(lancamentos.len() >= 2, "deveria lançar mais de um");
        let intervalo = lancamentos[1] - lancamentos[0];
        assert!(
            intervalo >= CACADOR_INTERVALO - 0.5,
            "intervalo curto demais: {intervalo}"
        );
    }

    #[test]
    fn o_cacador_mantem_distancia_de_tiro() {
        // Colado no jogador ele viraria alvo trivial, e os torpedos não
        // teriam espaço para perseguir — sumindo com o que se quer
        // testar.
        let jogador = [0.0f32, 0.0, 0.0];
        let mut d = TrainingDummy::new(TrainingKind::Cacador, [0.0, 0.0, 900.0]);
        let mut a = d.step(1.0 / 30.0, jogador);
        for _ in 0..(30 * 30) {
            a = d.step(1.0 / 30.0, jogador);
        }
        let dist = len(sub(a.position, jogador));
        assert!(
            (200.0..600.0).contains(&dist),
            "deveria estabilizar a distância de tiro, ficou em {dist}"
        );
    }

    #[test]
    fn cada_alvo_nasce_a_uma_distancia_diferente() {
        // Empilhados no mesmo ponto, seria impossível escolher qual
        // exercitar.
        let mut ds: Vec<f32> = training_range()
            .iter()
            .map(|k| k.spawn_distance())
            .collect();
        ds.sort_by(|a, b| a.partial_cmp(b).unwrap());
        for par in ds.windows(2) {
            assert!(par[1] - par[0] > 50.0, "distâncias próximas demais: {ds:?}");
        }
    }

    #[test]
    fn o_cacador_aguenta_mais_tiro_que_os_outros() {
        // Ele é o alvo das defesas, não da pontaria: precisa sobreviver
        // enquanto o jogador tenta as quatro saídas.
        assert!(TrainingKind::Cacador.hull() > TrainingKind::Parado.hull());
        assert!(TrainingKind::Cacador.hull() > TrainingKind::Corredor.hull());
    }

    #[test]
    fn todo_alvo_tem_nome_proprio() {
        let nomes: Vec<&str> = training_range().iter().map(|k| k.label()).collect();
        let unicos: std::collections::HashSet<&str> = nomes.iter().copied().collect();
        assert_eq!(unicos.len(), nomes.len());
    }
}
