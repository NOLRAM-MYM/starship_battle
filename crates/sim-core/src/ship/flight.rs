//! Resposta de comando de voo: como a entrada do teclado vira rotação.
//!
//! Antes, cada eixo ia direto do teclado para a rotação: a entrada é
//! -1, 0 ou +1, e virava velocidade angular CONSTANTE no mesmo quadro.
//! Isso torna a nave impossível de enquadrar — só existem três estados
//! (girando a toda para um lado, parado, girando a toda para o outro), e
//! centralizar um alvo vira uma sequência de correções em zigue-zague,
//! cada uma passando do ponto.
//!
//! A resposta aqui é de TAXA COMANDADA, que é o que voa em qualquer
//! aeronave moderna: a entrada pede uma velocidade angular, e a nave
//! acelera até ela. Isso dá três coisas de uma vez:
//!
//! 1. **Peso** — a nave leva um instante para começar e para parar, o
//!    que é o que se espera de algo com massa.
//! 2. **Precisão** — um toque curto produz uma rotação pequena, porque a
//!    taxa nem chega ao máximo. Com resposta direta, o toque mais curto
//!    possível já era rotação máxima por um quadro inteiro.
//! 3. **Estabilidade** — soltando o comando, a rotação decai sozinha.
//!
//! Vale dizer o que este modelo NÃO é: rotação newtoniana pura, em que a
//! nave gira para sempre até você frear com o comando oposto. É mais
//! realista em espaço, e é exatamente o que torna mira impossível para
//! quem não treinou horas. O amortecimento aqui é o mesmo que um sistema
//! de controle de atitude faria — não é "modo fácil", é o piloto
//! automático que qualquer nave com computador teria.

use serde::{Deserialize, Serialize};

/// Parâmetros de resposta de um eixo.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct FlightTuning {
    /// Velocidade angular máxima, em rad/s.
    pub max_rate: f32,
    /// Aceleração angular ao perseguir a taxa comandada, em rad/s².
    ///
    /// É o que dá "peso". Alta demais e volta a parecer digital; baixa
    /// demais e a nave parece afundada em melado.
    pub accel: f32,
    /// Desaceleração quando não há comando, em rad/s².
    ///
    /// Maior que `accel` de propósito: parar tem que ser mais rápido que
    /// começar, senão a nave passa do ponto toda vez que o jogador solta
    /// a tecla — que é justamente a queixa de "difícil de enquadrar".
    pub damping: f32,
    /// Fração da taxa máxima no modo de precisão.
    pub fine_scale: f32,
}

/// Ajuste padrão de uma nave de combate.
///
/// `max_rate` bate com o `turn_rate` que o servidor já usava, para que
/// a mudança seja de RESPOSTA e não de agilidade: a nave não ficou mais
/// lenta, ficou mais controlável.
pub const DEFAULT_TUNING: FlightTuning = FlightTuning {
    max_rate: 1.6,
    // 4.5 rad/s²: ~0.36s até a taxa máxima. Com 6.5 (0.25s), um toque
    // de 100ms já entregava 41% da rotação máxima — rápido demais para
    // as correções pequenas que enquadrar um alvo exige. A taxa máxima
    // não mudou: a nave não ficou mais lenta, ficou mais controlável.
    accel: 4.5,
    damping: 9.0,
    fine_scale: 0.32,
};

/// Avança a velocidade angular de um eixo.
///
/// `input` em -1..=1, `current` e o retorno em rad/s.
pub fn step_axis(current: f32, input: f32, fine: bool, t: &FlightTuning, dt: f32) -> f32 {
    let entrada = input.clamp(-1.0, 1.0);
    let teto = if fine {
        t.max_rate * t.fine_scale
    } else {
        t.max_rate
    };
    let comandada = entrada * teto;

    // Sem comando, ou comando contrário ao movimento: o amortecimento
    // manda. Perseguir a taxa comandada com `accel` nos dois casos faria
    // a inversão de direção demorar o dobro.
    let ganho = if entrada.abs() < 1e-4 || (comandada - current) * current < 0.0 {
        t.damping
    } else {
        t.accel
    };

    let delta = comandada - current;
    let passo = ganho * dt;
    let novo = if delta.abs() <= passo {
        comandada
    } else {
        current + passo * delta.signum()
    };

    // No modo de precisão o teto é menor, mas uma taxa herdada do modo
    // normal não pode ser cortada de repente: isso daria um solavanco.
    // O amortecimento cuida de trazê-la para baixo.
    novo.clamp(-t.max_rate, t.max_rate)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DT: f32 = 1.0 / 30.0;

    fn t() -> FlightTuning {
        DEFAULT_TUNING
    }

    /// Roda `n` passos com a mesma entrada.
    fn simular(mut r: f32, input: f32, fine: bool, n: usize) -> f32 {
        for _ in 0..n {
            r = step_axis(r, input, fine, &t(), DT);
        }
        r
    }

    #[test]
    fn parte_do_repouso_e_nao_salta_para_o_maximo() {
        // O defeito original: um único quadro de tecla já produzia
        // rotação máxima, e não havia como fazer uma correção pequena.
        let depois_de_um_quadro = step_axis(0.0, 1.0, false, &t(), DT);
        assert!(
            depois_de_um_quadro < t().max_rate * 0.5,
            "um quadro não pode dar meia rotação: {depois_de_um_quadro}"
        );
        assert!(depois_de_um_quadro > 0.0, "mas tem que começar a girar");
    }

    #[test]
    fn chega_a_taxa_maxima_se_o_comando_continuar() {
        // Ter peso não pode virar lentidão: segurando, a nave gira tão
        // rápido quanto antes.
        let r = simular(0.0, 1.0, false, 30);
        assert!((r - t().max_rate).abs() < 0.01, "r={r}");
    }

    #[test]
    fn nunca_passa_da_taxa_maxima() {
        let r = simular(0.0, 1.0, false, 300);
        assert!(r <= t().max_rate + 1e-4);
    }

    #[test]
    fn solta_a_tecla_e_a_rotacao_para_sozinha() {
        // É o que permite enquadrar: sem amortecimento, a nave continua
        // girando e o alvo escapa pelo outro lado.
        let girando = simular(0.0, 1.0, false, 30);
        let parando = simular(girando, 0.0, false, 30);
        assert!(parando.abs() < 0.01, "deveria ter parado: {parando}");
    }

    #[test]
    fn parar_e_mais_rapido_que_comecar() {
        // Se parar demorasse o mesmo que começar, toda correção passaria
        // do ponto — a queixa exata de "difícil de enquadrar".
        let t = t();
        let quadros_ate = |alvo: f32, input: f32, inicial: f32| {
            let mut r = inicial;
            for i in 0..1000 {
                r = step_axis(r, input, false, &t, DT);
                if (r - alvo).abs() < 0.05 {
                    return i;
                }
            }
            9999
        };
        let acelerar = quadros_ate(t.max_rate, 1.0, 0.0);
        let frear = quadros_ate(0.0, 0.0, t.max_rate);
        assert!(frear < acelerar, "frear {frear} vs acelerar {acelerar}");
    }

    #[test]
    fn um_toque_curto_produz_rotacao_pequena() {
        // O caso de uso central: ajustar a mira alguns graus.
        let toque = simular(0.0, 1.0, false, 3);
        let segurando = simular(0.0, 1.0, false, 30);
        assert!(
            toque < segurando * 0.4,
            "toque {toque} deveria ser bem menor que {segurando}"
        );
    }

    #[test]
    fn o_modo_de_precisao_limita_a_taxa() {
        let normal = simular(0.0, 1.0, false, 60);
        let fino = simular(0.0, 1.0, true, 60);
        assert!(fino < normal * 0.5, "fino={fino} normal={normal}");
        assert!(fino > 0.0, "o modo de precisão ainda tem que girar");
    }

    #[test]
    fn o_modo_de_precisao_nao_corta_a_rotacao_de_repente() {
        // Entrar no modo fino girando a toda não pode dar um solavanco:
        // o amortecimento traz a taxa para baixo em vez de zerá-la.
        let girando = simular(0.0, 1.0, false, 60);
        let logo_depois = step_axis(girando, 1.0, true, &t(), DT);
        assert!(
            logo_depois < girando,
            "deveria começar a reduzir: {logo_depois} vs {girando}"
        );
        assert!(
            logo_depois > girando * 0.7,
            "mas sem solavanco: {logo_depois} vs {girando}"
        );
    }

    #[test]
    fn inverter_o_comando_e_rapido() {
        // Girar para um lado e mandar o oposto tem que responder na
        // hora: é a manobra de correção mais comum em combate.
        let girando = simular(0.0, 1.0, false, 60);
        let invertendo = simular(girando, -1.0, false, 15);
        assert!(invertendo < 0.0, "deveria ter invertido: {invertendo}");
    }

    #[test]
    fn a_resposta_e_simetrica() {
        let d = simular(0.0, 1.0, false, 20);
        let e = simular(0.0, -1.0, false, 20);
        assert!((d + e).abs() < 1e-4, "{d} vs {e}");
    }

    #[test]
    fn entrada_fora_da_faixa_e_saturada() {
        let r = simular(0.0, 99.0, false, 60);
        assert!(r <= t().max_rate + 1e-4);
    }

    #[test]
    fn dt_grande_nao_faz_a_taxa_explodir() {
        // Um quadro perdido (aba em segundo plano) não pode catapultar
        // a nave.
        let r = step_axis(0.0, 1.0, false, &t(), 1.0);
        assert!(r <= t().max_rate + 1e-4, "r={r}");
    }
}
