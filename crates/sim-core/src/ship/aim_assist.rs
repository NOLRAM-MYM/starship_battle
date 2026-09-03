//! Rastreamento assistido: segurar a mira ajuda a ACOMPANHAR o alvo.
//!
//! O problema real: mesmo com o ponto de impacto desenhado na tela,
//! manter o nariz sobre ele exige correções contínuas de fração de grau,
//! porque o alvo se move e a gravidade encurva o tiro. Com teclado isso
//! é quase impossível; com alavanca é cansativo.
//!
//! A solução preguiçosa seria travar a mira no alvo. Isso mata o jogo:
//! quem aperta o botão acerta, e não há mais o que praticar. O
//! rastreamento aqui é deliberadamente PARCIAL, e as três limitações são
//! o que separa um auxílio de um trapaça:
//!
//! 1. **Não adquire, só refina.** Fora de um cone estreito o auxílio é
//!    zero. Pôr o alvo na mira continua sendo trabalho do jogador; a
//!    assistência só evita que ele escorregue.
//! 2. **Esquiva vence o auxílio.** A força cai com a aceleração
//!    TRANSVERSAL do alvo. Uma manobra brusca desliga o rastreamento
//!    justamente quando ela acontece — perseguir alguém que sabe voar
//!    continua difícil.
//! 3. **Dobra corta tudo.** Em salto o alvo passa dos 400 u/s; nenhum
//!    auxílio acompanha, do mesmo jeito que nenhum torpedo mantém a
//!    trava.
//!
//! E há um teto absoluto: o auxílio nunca gira mais rápido que uma
//! fração da própria taxa da nave. Quem está pilotando continua sendo o
//! jogador — a assistência corrige, não conduz.

use serde::{Deserialize, Serialize};

/// Ajuste do rastreamento assistido.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct AssistTuning {
    /// Fração da taxa de giro da nave que o auxílio pode usar.
    ///
    /// Bem abaixo de 1: acima disso a nave passaria a ser conduzida pela
    /// assistência, e o jogador viraria passageiro.
    pub max_fraction: f32,
    /// Erro angular (rad) até onde o auxílio vale integralmente.
    pub full_angle: f32,
    /// Erro angular (rad) a partir do qual o auxílio é zero.
    ///
    /// É o que impede a trava: fora deste cone, achar o alvo é trabalho
    /// do jogador.
    pub cutoff_angle: f32,
    /// Aceleração transversal do alvo (u/s²) que anula o auxílio.
    ///
    /// Abaixo disso a força decai proporcionalmente. É o que faz uma
    /// esquiva brusca funcionar como defesa.
    pub juke_cutoff: f32,
}

pub const DEFAULT_ASSIST: AssistTuning = AssistTuning {
    // 45%: sensível o bastante para segurar um alvo que já está na mira,
    // fraco o bastante para não vencer a intenção do jogador.
    max_fraction: 0.45,
    // ~6° de erro: dentro disso o tiro já quase acerta, e o auxílio só
    // impede o escorregamento.
    full_angle: 0.105,
    // ~25°: além disso o jogador tem que virar a nave por conta própria.
    cutoff_angle: 0.44,
    // 120 u/s²: uma guinada de verdade, não a correção de rumo de quem
    // está voando reto.
    juke_cutoff: 120.0,
};

/// Situação do alvo no momento do disparo.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AssistInput {
    /// Direção para onde o nariz aponta (unitária).
    pub forward: [f32; 3],
    /// Direção do atirador até o PONTO DE IMPACTO (unitária).
    ///
    /// Ponto de impacto, e não posição atual do alvo: apontar para onde
    /// ele está agora faz errar por antecipação, e a assistência estaria
    /// ativamente atrapalhando.
    pub to_lead: [f32; 3],
    /// Aceleração transversal do alvo, em u/s².
    pub target_transverse_accel: f32,
    /// `true` se o alvo está em dobra.
    pub target_warping: bool,
    /// Taxa de giro máxima da nave, rad/s.
    pub turn_rate: f32,
}

/// Taxas angulares adicionais, em rad/s.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AssistRates {
    /// Arfagem: positivo levanta o nariz.
    pub pitch: f32,
    /// Guinada: positivo vira para a direita.
    pub yaw: f32,
    /// 0..1 — quanto do auxílio está ativo. Alimenta o retorno visual.
    pub strength: f32,
}

impl AssistRates {
    pub const ZERO: AssistRates = AssistRates {
        pitch: 0.0,
        yaw: 0.0,
        strength: 0.0,
    };
}

fn norm(v: [f32; 3]) -> [f32; 3] {
    let l = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if l < 1e-6 {
        return [0.0, 0.0, 1.0];
    }
    [v[0] / l, v[1] / l, v[2] / l]
}
fn dot(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

/// Quanto o auxílio vale nesta situação, de 0 a 1.
///
/// Separado do cálculo das taxas porque é a REGRA DE EQUILÍBRIO — o que
/// decide se o recurso ajuda ou entrega o jogo. Isolado, dá para testá-la
/// sem montar geometria.
pub fn assist_strength(input: &AssistInput, t: &AssistTuning) -> f32 {
    if input.target_warping {
        return 0.0;
    }

    let f = norm(input.forward);
    let l = norm(input.to_lead);
    let ang = dot(f, l).clamp(-1.0, 1.0).acos();

    // Fora do cone: nada. Dentro do cone interno: tudo. Entre os dois:
    // decai linearmente.
    let por_angulo = if ang <= t.full_angle {
        1.0
    } else if ang >= t.cutoff_angle {
        0.0
    } else {
        1.0 - (ang - t.full_angle) / (t.cutoff_angle - t.full_angle)
    };

    // Esquiva: quanto mais brusca, menos auxílio.
    let por_esquiva =
        (1.0 - (input.target_transverse_accel / t.juke_cutoff).clamp(0.0, 1.0)).clamp(0.0, 1.0);

    (por_angulo * por_esquiva).clamp(0.0, 1.0)
}

/// Taxas angulares que aproximam o nariz do ponto de impacto.
pub fn assist_rates(input: &AssistInput, t: &AssistTuning) -> AssistRates {
    let strength = assist_strength(input, t);
    if strength <= 1e-4 {
        return AssistRates::ZERO;
    }

    let f = norm(input.forward);
    let l = norm(input.to_lead);
    let ang = dot(f, l).clamp(-1.0, 1.0).acos();
    if ang < 1e-5 {
        return AssistRates {
            pitch: 0.0,
            yaw: 0.0,
            strength,
        };
    }

    // Eixo de rotação que leva `forward` até `to_lead`.
    let eixo = cross(f, l);
    let eixo_len = (eixo[0] * eixo[0] + eixo[1] * eixo[1] + eixo[2] * eixo[2]).sqrt();
    if eixo_len < 1e-6 {
        return AssistRates {
            pitch: 0.0,
            yaw: 0.0,
            strength,
        };
    }
    let eixo = [
        eixo[0] / eixo_len,
        eixo[1] / eixo_len,
        eixo[2] / eixo_len,
    ];

    // Decompõe nos eixos locais da nave. Com a frente em +Z, o eixo de
    // arfagem é X e o de guinada é Y.
    //
    // Os sinais seguem a convenção da ENTRADA DO JOGADOR (+pitch = nariz
    // para cima, +yaw = para a direita), e não a dos eixos crus, porque
    // é a isso que o servidor soma o auxílio — e lá os dois são negados
    // antes de virar rotação. Emitir no referencial do eixo fazia a
    // guinada sair ao contrário: o auxílio afastava a mira do alvo em
    // vez de aproximá-la, e o teste do módulo, escrito com a mesma
    // suposição, concordava com o erro.
    let disponivel = input.turn_rate * t.max_fraction * strength;
    // Nunca gira mais do que o erro restante: passar do ponto faria a
    // mira oscilar em torno do alvo em vez de assentar nele.
    let passo = disponivel.min(ang / 0.05);

    AssistRates {
        pitch: -eixo[0] * passo,
        yaw: -eixo[1] * passo,
        strength,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> AssistInput {
        AssistInput {
            forward: [0.0, 0.0, 1.0],
            to_lead: [0.0, 0.0, 1.0],
            target_transverse_accel: 0.0,
            target_warping: false,
            turn_rate: 1.6,
        }
    }

    /// Direção a `graus` de +Z, girando no plano XZ.
    fn desviado(graus: f32) -> [f32; 3] {
        let r = graus.to_radians();
        [r.sin(), 0.0, r.cos()]
    }

    #[test]
    fn ja_alinhado_nao_precisa_de_ajuda() {
        let r = assist_rates(&base(), &DEFAULT_ASSIST);
        assert!(r.pitch.abs() < 1e-3);
        assert!(r.yaw.abs() < 1e-3);
    }

    #[test]
    fn erro_pequeno_recebe_auxilio_cheio() {
        let mut i = base();
        i.to_lead = desviado(4.0);
        assert!((assist_strength(&i, &DEFAULT_ASSIST) - 1.0).abs() < 1e-4);
    }

    #[test]
    fn fora_do_cone_nao_ha_auxilio_nenhum() {
        // É o que impede a trava: achar o alvo continua sendo trabalho
        // do jogador. Sem isto, apertar o botão bastaria para acertar.
        let mut i = base();
        i.to_lead = desviado(40.0);
        assert_eq!(assist_strength(&i, &DEFAULT_ASSIST), 0.0);
        assert_eq!(assist_rates(&i, &DEFAULT_ASSIST), AssistRates::ZERO);
    }

    #[test]
    fn o_auxilio_decai_com_o_angulo() {
        let mut perto = base();
        perto.to_lead = desviado(10.0);
        let mut longe = base();
        longe.to_lead = desviado(20.0);
        assert!(
            assist_strength(&perto, &DEFAULT_ASSIST) > assist_strength(&longe, &DEFAULT_ASSIST)
        );
    }

    #[test]
    fn esquiva_brusca_derruba_o_auxilio() {
        // A defesa central: quem manobra escapa do rastreamento.
        let mut i = base();
        i.to_lead = desviado(5.0);
        let parado = assist_strength(&i, &DEFAULT_ASSIST);
        i.target_transverse_accel = DEFAULT_ASSIST.juke_cutoff * 0.75;
        let esquivando = assist_strength(&i, &DEFAULT_ASSIST);
        assert!(esquivando < parado * 0.4, "{esquivando} vs {parado}");
    }

    #[test]
    fn esquiva_muito_forte_anula_o_auxilio() {
        let mut i = base();
        i.to_lead = desviado(3.0);
        i.target_transverse_accel = DEFAULT_ASSIST.juke_cutoff * 2.0;
        assert_eq!(assist_strength(&i, &DEFAULT_ASSIST), 0.0);
    }

    #[test]
    fn manobra_suave_ainda_permite_auxilio() {
        // Se qualquer curva desligasse o recurso, ele não serviria para
        // nada: voar reto perfeitamente não acontece.
        let mut i = base();
        i.to_lead = desviado(4.0);
        i.target_transverse_accel = 15.0;
        assert!(assist_strength(&i, &DEFAULT_ASSIST) > 0.8);
    }

    #[test]
    fn dobra_corta_o_auxilio_por_completo() {
        let mut i = base();
        i.to_lead = desviado(2.0);
        i.target_warping = true;
        assert_eq!(assist_strength(&i, &DEFAULT_ASSIST), 0.0);
    }

    #[test]
    fn o_auxilio_nunca_passa_do_teto() {
        // Acima disso a nave seria conduzida pela assistência e o
        // jogador viraria passageiro.
        let mut i = base();
        i.to_lead = desviado(6.0);
        let r = assist_rates(&i, &DEFAULT_ASSIST);
        let total = (r.pitch * r.pitch + r.yaw * r.yaw).sqrt();
        assert!(
            total <= i.turn_rate * DEFAULT_ASSIST.max_fraction + 1e-4,
            "total={total}"
        );
    }

    #[test]
    fn o_auxilio_e_bem_menor_que_o_comando_do_jogador() {
        let mut i = base();
        i.to_lead = desviado(6.0);
        let r = assist_rates(&i, &DEFAULT_ASSIST);
        let total = (r.pitch * r.pitch + r.yaw * r.yaw).sqrt();
        assert!(total < i.turn_rate * 0.5);
    }

    #[test]
    fn gira_para_o_lado_certo_na_guinada() {
        // Convenção de ENTRADA do jogador, que é a que o servidor soma:
        // com a frente em +Z, girar o nariz para +X é guinada NEGATIVA
        // (o servidor nega os dois eixos antes de aplicar). Assumir o
        // contrário fazia o auxílio afastar a mira do alvo.
        let mut i = base();
        i.to_lead = desviado(8.0);
        let r = assist_rates(&i, &DEFAULT_ASSIST);
        assert!(r.yaw < 0.0, "yaw={}", r.yaw);
        i.to_lead = desviado(-8.0);
        assert!(assist_rates(&i, &DEFAULT_ASSIST).yaw > 0.0);
    }

    #[test]
    fn levanta_o_nariz_quando_o_alvo_esta_acima() {
        let mut i = base();
        // 8° acima: +Y com a frente em +Z.
        let r8 = 8f32.to_radians();
        i.to_lead = [0.0, r8.sin(), r8.cos()];
        let r = assist_rates(&i, &DEFAULT_ASSIST);
        assert!(r.pitch > 0.0, "pitch={}", r.pitch);
    }

    #[test]
    fn nao_passa_do_ponto_com_erro_minusculo() {
        // Girar mais do que o erro restante faria a mira oscilar em
        // torno do alvo em vez de assentar nele.
        let mut i = base();
        i.to_lead = desviado(0.2);
        let r = assist_rates(&i, &DEFAULT_ASSIST);
        let total = (r.pitch * r.pitch + r.yaw * r.yaw).sqrt();
        let erro = 0.2f32.to_radians();
        assert!(total <= erro / 0.05 + 1e-4, "total={total}");
    }

    #[test]
    fn direcao_degenerada_nao_produz_nan() {
        let mut i = base();
        i.forward = [0.0, 0.0, 0.0];
        i.to_lead = [0.0, 0.0, 0.0];
        let r = assist_rates(&i, &DEFAULT_ASSIST);
        assert!(r.pitch.is_finite() && r.yaw.is_finite());
    }

    #[test]
    fn alvo_exatamente_atras_nao_recebe_auxilio() {
        let mut i = base();
        i.to_lead = [0.0, 0.0, -1.0];
        assert_eq!(assist_strength(&i, &DEFAULT_ASSIST), 0.0);
    }

    #[test]
    fn a_forca_fica_sempre_entre_zero_e_um() {
        let mut i = base();
        i.to_lead = desviado(7.0);
        i.target_transverse_accel = -50.0; // valor absurdo
        let s = assist_strength(&i, &DEFAULT_ASSIST);
        assert!((0.0..=1.0).contains(&s), "s={s}");
    }
}
