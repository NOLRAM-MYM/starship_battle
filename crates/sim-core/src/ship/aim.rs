//! Solução de mira: para onde apontar para acertar um alvo em movimento.
//!
//! Acertar exigia adivinhar. O jogador via o inimigo onde ele ESTAVA, não
//! onde estará quando o projétil chegar, e a gravidade ainda encurvava o
//! tiro no caminho — duas correções mentais simultâneas, cada uma
//! dependendo do tempo de voo, que por sua vez depende da correção. Na
//! prática ninguém acerta um alvo cruzando a 60 u/s a 800 unidades.
//!
//! Aqui a conta é feita de verdade, e junto com ela sai uma medida de
//! QUÃO DIFÍCIL o tiro é. Essa medida é o ponto: um tiro à queima-roupa
//! contra um alvo parado é certeza; o mesmo tiro atravessando o poço de
//! uma gigante gasosa, contra um alvo cruzando rápido, é aposta. A
//! interface mostra a diferença em vez de fingir que toda mira vale o
//! mesmo.
//!
//! O módulo é puro: o cliente usa para desenhar o retículo e o servidor
//! pode usar para a pontaria de NPC, sem que os dois divirjam.

use serde::{Deserialize, Serialize};

/// Entrada do solucionador.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AimInput {
    pub shooter_pos: [f32; 3],
    pub shooter_vel: [f32; 3],
    pub target_pos: [f32; 3],
    pub target_vel: [f32; 3],
    /// Velocidade do projétil ao sair do cano (relativa à nave).
    pub projectile_speed: f32,
    /// Aceleração gravitacional média no trecho, em u/s².
    pub gravity: [f32; 3],
    /// Tempo de vida do projétil. Além disso ele expira sem chegar.
    pub projectile_ttl: f32,
}

/// Resultado da mira.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct AimSolution {
    /// Ponto do espaço para onde apontar.
    pub lead_point: [f32; 3],
    /// Tempo de voo estimado, em segundos.
    pub time_of_flight: f32,
    /// 0 = tiro trivial, 1 = praticamente impossível.
    pub difficulty: f32,
    /// `false` quando nem existe solução: alvo rápido demais ou fora do
    /// alcance do projétil.
    pub reachable: bool,
}

fn sub(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn add(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
fn scale(a: [f32; 3], k: f32) -> [f32; 3] {
    [a[0] * k, a[1] * k, a[2] * k]
}
fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn len(a: [f32; 3]) -> f32 {
    dot(a, a).sqrt()
}

/// Quantas vezes refinar o tempo de voo.
///
/// O problema é implícito — o tempo de voo depende de onde o alvo
/// estará, que depende do tempo de voo. Três passos de ponto fixo já
/// convergem para menos de 1% nas velocidades do jogo, e o custo importa
/// porque isto roda a cada quadro para o retículo.
const REFINOS: usize = 3;

/// Resolve a mira.
///
/// Usa iteração de ponto fixo em vez da quadrática fechada porque a
/// gravidade curva a trajetória: a forma fechada só vale para tiro
/// retilíneo, e daria uma resposta plausível e errada justamente perto
/// dos corpos celestes, que é onde o jogador mais precisa dela.
pub fn solve(input: &AimInput) -> AimSolution {
    let rel_pos = sub(input.target_pos, input.shooter_pos);
    // O projétil herda a velocidade da nave, então o que importa é a
    // velocidade RELATIVA do alvo.
    let rel_vel = sub(input.target_vel, input.shooter_vel);
    let distancia = len(rel_pos);

    if input.projectile_speed <= 0.001 {
        return AimSolution {
            lead_point: input.target_pos,
            time_of_flight: 0.0,
            difficulty: 1.0,
            reachable: false,
        };
    }

    // Ponto fixo: estima o tempo, projeta o alvo, recalcula o tempo.
    let mut t = distancia / input.projectile_speed;
    let mut alvo_futuro = input.target_pos;
    for _ in 0..REFINOS {
        // Onde o alvo estará em `t`.
        alvo_futuro = add(input.target_pos, scale(rel_vel, t));
        // A gravidade desloca o PROJÉTIL, então o ponto de mira sobe na
        // direção oposta à queda: -½gt².
        let queda = scale(input.gravity, 0.5 * t * t);
        let mira = sub(alvo_futuro, queda);
        let d = len(sub(mira, input.shooter_pos));
        t = d / input.projectile_speed;
    }

    let queda = scale(input.gravity, 0.5 * t * t);
    let lead_point = sub(alvo_futuro, queda);

    let reachable = t <= input.projectile_ttl;

    AimSolution {
        lead_point,
        time_of_flight: t,
        difficulty: difficulty_of(input, rel_vel, distancia, t, reachable),
        reachable,
    }
}

/// Mede quão difícil é o tiro, de 0 a 1.
///
/// Três fatores, porque são três coisas diferentes que erram o tiro:
///
/// 1. **Antecipação** — quanto o alvo se desloca lateralmente durante o
///    voo. É o erro clássico de tiro a distância, e cresce com a
///    velocidade TRANSVERSAL: um alvo vindo de frente a 200 u/s é fácil,
///    um cruzando a 60 u/s é difícil.
/// 2. **Gravidade** — o quanto a trajetória encurva no caminho. Perto de
///    uma gigante gasosa o desvio passa de dezenas de unidades.
/// 3. **Alcance** — a fração do tempo de vida do projétil consumida. No
///    limite, qualquer manobra do alvo já basta para escapar.
fn difficulty_of(
    input: &AimInput,
    rel_vel: [f32; 3],
    distancia: f32,
    t: f32,
    reachable: bool,
) -> f32 {
    if !reachable {
        return 1.0;
    }
    if distancia < 0.001 {
        return 0.0;
    }

    // Componente da velocidade relativa PERPENDICULAR à linha de tiro.
    // A componente radial (aproximando ou afastando) quase não atrapalha.
    let dir = scale(sub(input.target_pos, input.shooter_pos), 1.0 / distancia);
    let radial = dot(rel_vel, dir);
    let transversal = len(sub(rel_vel, scale(dir, radial)));

    // Deslocamento lateral do alvo durante o voo, em unidades.
    let desvio_alvo = transversal * t;
    // Desvio do projétil pela gravidade, em unidades.
    let desvio_grav = 0.5 * len(input.gravity) * t * t;

    // Normalizados por uma "margem de acerto" de 12 unidades: um desvio
    // dessa ordem já é a diferença entre acertar e passar de raspão.
    const MARGEM: f32 = 12.0;
    let f_alvo = (desvio_alvo / MARGEM).min(1.0);
    let f_grav = (desvio_grav / MARGEM).min(1.0);
    let f_alcance = (t / input.projectile_ttl.max(0.001)).min(1.0);

    // Pesos: a antecipação domina, a gravidade vem em seguida, e o
    // alcance é o desempate — dá para acertar longe se o alvo vier reto.
    let bruto = 0.5 * f_alvo + 0.35 * f_grav + 0.15 * f_alcance;
    bruto.clamp(0.0, 1.0)
}

/// Faixa de dificuldade, para a interface escolher a cor e o texto.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AimBand {
    /// Tiro praticamente certo.
    Easy,
    /// Exige alguma antecipação.
    Moderate,
    /// Antecipação grande, ou trajetória bem encurvada.
    Hard,
    /// Fora de alcance ou sem solução.
    Extreme,
}

pub fn band_of(difficulty: f32, reachable: bool) -> AimBand {
    if !reachable {
        return AimBand::Extreme;
    }
    match difficulty {
        d if d < 0.25 => AimBand::Easy,
        d if d < 0.55 => AimBand::Moderate,
        d if d < 0.85 => AimBand::Hard,
        _ => AimBand::Extreme,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> AimInput {
        AimInput {
            shooter_pos: [0.0, 0.0, 0.0],
            shooter_vel: [0.0, 0.0, 0.0],
            target_pos: [0.0, 0.0, 200.0],
            target_vel: [0.0, 0.0, 0.0],
            projectile_speed: 200.0,
            gravity: [0.0, 0.0, 0.0],
            projectile_ttl: 4.0,
        }
    }

    #[test]
    fn alvo_parado_sem_gravidade_mira_nele_mesmo() {
        let s = solve(&base());
        assert!((s.lead_point[2] - 200.0).abs() < 0.5);
        assert!((s.time_of_flight - 1.0).abs() < 0.05);
        assert!(s.reachable);
    }

    #[test]
    fn alvo_cruzando_exige_antecipacao_a_frente() {
        // Alvo a 200 de distância cruzando em +X a 50 u/s. Com ~1s de
        // voo, a mira tem que ir uns 50 para +X.
        let mut i = base();
        i.target_vel = [50.0, 0.0, 0.0];
        let s = solve(&i);
        assert!(
            s.lead_point[0] > 40.0,
            "deveria antecipar em +X, foi {}",
            s.lead_point[0]
        );
    }

    #[test]
    fn gravidade_faz_a_mira_subir_contra_a_queda() {
        // Gravidade puxando para -Y: mira acima do alvo.
        let mut i = base();
        i.gravity = [0.0, -30.0, 0.0];
        let s = solve(&i);
        assert!(
            s.lead_point[1] > 10.0,
            "mira deveria compensar a queda, foi {}",
            s.lead_point[1]
        );
    }

    #[test]
    fn velocidade_da_propria_nave_e_descontada() {
        // O projétil herda a velocidade da nave: se as duas viajam
        // juntas, não há antecipação nenhuma a fazer.
        let mut i = base();
        i.shooter_vel = [50.0, 0.0, 0.0];
        i.target_vel = [50.0, 0.0, 0.0];
        let s = solve(&i);
        assert!(
            s.lead_point[0].abs() < 2.0,
            "sem velocidade relativa não há antecipação, foi {}",
            s.lead_point[0]
        );
    }

    #[test]
    fn alvo_parado_e_perto_e_facil() {
        let s = solve(&base());
        assert!(s.difficulty < 0.25, "difficulty={}", s.difficulty);
        assert_eq!(band_of(s.difficulty, s.reachable), AimBand::Easy);
    }

    #[test]
    fn alvo_cruzando_rapido_e_mais_dificil_que_alvo_parado() {
        let parado = solve(&base());
        let mut i = base();
        i.target_vel = [80.0, 0.0, 0.0];
        let cruzando = solve(&i);
        assert!(cruzando.difficulty > parado.difficulty);
    }

    #[test]
    fn aproximar_de_frente_e_mais_facil_que_cruzar_na_mesma_velocidade() {
        // O ponto que separa uma medida útil de uma inútil: velocidade
        // RADIAL quase não atrapalha, velocidade TRANSVERSAL sim.
        let mut frontal = base();
        frontal.target_vel = [0.0, 0.0, -80.0];
        let mut lateral = base();
        lateral.target_vel = [80.0, 0.0, 0.0];
        assert!(solve(&frontal).difficulty < solve(&lateral).difficulty);
    }

    #[test]
    fn gravidade_forte_aumenta_a_dificuldade() {
        let sem = solve(&base());
        let mut i = base();
        i.gravity = [0.0, -60.0, 0.0];
        let com = solve(&i);
        assert!(
            com.difficulty > sem.difficulty,
            "{} vs {}",
            com.difficulty,
            sem.difficulty
        );
    }

    #[test]
    fn alvo_alem_do_alcance_nao_e_alcancavel() {
        let mut i = base();
        i.target_pos = [0.0, 0.0, 5000.0];
        let s = solve(&i);
        assert!(!s.reachable);
        assert_eq!(s.difficulty, 1.0);
        assert_eq!(band_of(s.difficulty, s.reachable), AimBand::Extreme);
    }

    #[test]
    fn projetil_sem_velocidade_nao_tem_solucao() {
        let mut i = base();
        i.projectile_speed = 0.0;
        let s = solve(&i);
        assert!(!s.reachable);
    }

    #[test]
    fn a_dificuldade_fica_sempre_entre_zero_e_um() {
        // Valores extremos não podem produzir NaN nem estourar a faixa,
        // porque a interface usa isto direto como fator de cor.
        let mut i = base();
        i.target_vel = [9999.0, 9999.0, 9999.0];
        i.gravity = [0.0, -9999.0, 0.0];
        let s = solve(&i);
        assert!(s.difficulty.is_finite());
        assert!((0.0..=1.0).contains(&s.difficulty));
    }

    #[test]
    fn alvo_em_cima_do_atirador_nao_produz_nan() {
        let mut i = base();
        i.target_pos = [0.0, 0.0, 0.0];
        let s = solve(&i);
        assert!(s.difficulty.is_finite());
        assert!(s.lead_point.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn as_faixas_cobrem_a_escala_toda() {
        assert_eq!(band_of(0.0, true), AimBand::Easy);
        assert_eq!(band_of(0.4, true), AimBand::Moderate);
        assert_eq!(band_of(0.7, true), AimBand::Hard);
        assert_eq!(band_of(0.95, true), AimBand::Extreme);
        // Fora de alcance é sempre extremo, mesmo com número baixo.
        assert_eq!(band_of(0.0, false), AimBand::Extreme);
    }
}
