//! Sensores e furtividade: o alcance em que uma nave consegue travar outra.
//!
//! Estes módulos eram vendidos na loja e mostrados no hangar com números
//! — "Varredura Profunda: alcance +1500", "Manto Umbra: furtividade 45%"
//! — e o servidor não fazia nada com eles. Só somavam massa: equipar um
//! sensor deixava a nave mais lenta e nada mais. O Manto Umbra custava
//! 4.400 créditos e a única coisa que fazia era tirar 80 de escudo.
//!
//! O efeito escolhido é o que o jogo já tinha de autoritativo e que
//! depende de "enxergar" o alvo: a TRAVA. Sensores estendem o alcance em
//! que um torpedo adquire e mantém o alvo; furtividade o encurta para
//! quem tenta travar em você, e enfraquece a mira assistida contra você.
//!
//! Módulo puro, sem mundo: os números são testáveis aqui e o servidor só
//! os aplica.

/// Alcance de sensor que dobra o alcance de trava.
///
/// A mesma referência que o hangar usa para desenhar a barra de alcance
/// (`pct(stats.sensorRange, 3000)`), para o que se vê bater com o que
/// acontece.
pub const SENSOR_REFERENCIA: f32 = 3000.0;

/// Teto de furtividade, igual ao do hangar.
///
/// Sem teto, empilhar mantos chegaria a 100% e a nave ficaria
/// intravável — o que tiraria o torpedo do jogo contra ela.
pub const FURTIVIDADE_MAX: f32 = 0.9;

/// Alcance de sensor que um módulo acrescenta.
pub fn sensor_range(template_id: &str) -> f32 {
    match template_id {
        "sensor_array" => 600.0,
        "sensor_deep" => 1500.0,
        "vortex_tap" => 300.0,
        "wake_stabilizer" => 150.0,
        _ => 0.0,
    }
}

/// Fração de redução de assinatura que um módulo acrescenta.
pub fn stealth(template_id: &str) -> f32 {
    match template_id {
        "cloak_lvl1" => 0.18,
        "cloak_umbra" => 0.45,
        // Motores também têm assinatura: o iônico é silencioso, o Void
        // é um farol. Negativo só desconta dos mantos — o total nunca
        // fica abaixo de zero (ver `resolve_deteccao`), como no hangar.
        "engine_ion" => 0.05,
        "engine_void" => -0.12,
        _ => 0.0,
    }
}

/// Sensor e furtividade de um loadout inteiro.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Deteccao {
    pub sensor: f32,
    pub furtividade: f32,
}

pub fn resolve_deteccao(template_ids: &[String]) -> Deteccao {
    Deteccao {
        sensor: template_ids.iter().map(|id| sensor_range(id)).sum(),
        furtividade: furtividade_total(template_ids, 0.0),
    }
}

/// Furtividade dos módulos mais um bônus (de classe), limitada no FIM.
///
/// A ordem importa e é a do hangar: soma tudo, depois limita. Limitando
/// antes, um motor ruidoso (−0,12) com a classe Espectro (+0,15) daria
/// 0,15 no jogo e 0,03 no hangar.
pub fn furtividade_total(template_ids: &[String], bonus: f32) -> f32 {
    let bruta: f32 = template_ids.iter().map(|id| stealth(id)).sum();
    (bruta + bonus).clamp(0.0, FURTIVIDADE_MAX)
}

/// Quanto os sensores de quem trava ampliam o alcance-base.
pub fn ganho_de_sensor(sensor: f32) -> f32 {
    1.0 + sensor.max(0.0) / SENSOR_REFERENCIA
}

/// Quanto a furtividade do alvo encurta o alcance de quem trava.
pub fn fator_de_furtividade(furtividade: f32) -> f32 {
    1.0 - furtividade.clamp(0.0, FURTIVIDADE_MAX)
}

/// Alcance efetivo de trava contra um alvo específico.
pub fn alcance_de_trava(base: f32, sensor_de_quem_trava: f32, furtividade_do_alvo: f32) -> f32 {
    base * ganho_de_sensor(sensor_de_quem_trava) * fator_de_furtividade(furtividade_do_alvo)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn sem_modulos_o_alcance_e_o_base() {
        assert_eq!(alcance_de_trava(900.0, 0.0, 0.0), 900.0);
    }

    #[test]
    fn sensor_amplia_o_alcance() {
        let d = resolve_deteccao(&ids(&["sensor_deep"]));
        let com = alcance_de_trava(900.0, d.sensor, 0.0);
        assert!((com - 1350.0).abs() < 1e-3, "{com}");
    }

    #[test]
    fn furtividade_encurta_o_alcance() {
        let d = resolve_deteccao(&ids(&["cloak_umbra"]));
        let contra = alcance_de_trava(900.0, 0.0, d.furtividade);
        assert!((contra - 495.0).abs() < 1e-3, "{contra}");
    }

    #[test]
    fn furtividade_tem_teto() {
        // Empilhar mantos não pode tornar a nave intravável.
        let d = resolve_deteccao(&ids(&["cloak_umbra", "cloak_umbra", "cloak_umbra"]));
        assert_eq!(d.furtividade, FURTIVIDADE_MAX);
        assert!(alcance_de_trava(900.0, 0.0, d.furtividade) > 0.0);
    }

    #[test]
    fn motor_ruidoso_desconta_do_manto_sem_ficar_negativo() {
        let so_void = resolve_deteccao(&ids(&["engine_void"]));
        assert_eq!(so_void.furtividade, 0.0);
        let com_manto = resolve_deteccao(&ids(&["engine_void", "cloak_umbra"]));
        assert!((com_manto.furtividade - 0.33).abs() < 1e-4);
    }

    #[test]
    fn sensor_negativo_nao_encurta() {
        assert_eq!(ganho_de_sensor(-500.0), 1.0);
    }

    #[test]
    fn todo_modulo_de_deteccao_tem_efeito() {
        // Os módulos que motivaram este arquivo: nenhum pode voltar a
        // ser só massa.
        for id in ["sensor_array", "sensor_deep", "vortex_tap", "wake_stabilizer"] {
            assert!(sensor_range(id) > 0.0, "{id} sem alcance");
        }
        for id in ["cloak_lvl1", "cloak_umbra"] {
            assert!(stealth(id) > 0.0, "{id} sem furtividade");
        }
    }
}
