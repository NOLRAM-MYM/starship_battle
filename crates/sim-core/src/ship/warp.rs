//! Motor de dobra e vórtices de impulso.
//!
//! O `Dash` era um multiplicador de empuxo de 2x por 2 segundos — na
//! prática, indistinguível de segurar acelerar por mais tempo. Aqui ele
//! vira um **salto de dobra**: aceleração muito alta, imunidade a
//! colisão enquanto dura, e um rastro de **vórtices** que ficam no mundo
//! por alguns segundos.
//!
//! O vórtice é o que torna a mecânica interessante em multiplayer: ele
//! não é decoração. Qualquer nave que entre nele ganha impulso na
//! direção em que foi criado — inclusive quem está perseguindo. Fugir
//! por dobra deixa uma estrada aberta atrás de você.
//!
//! Módulo puro: só matemática e dados, sem rede nem ECS.

use serde::{Deserialize, Serialize};

/// Parâmetros de um salto de dobra.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct WarpProfile {
    /// Duração do salto, em segundos.
    pub duration: f32,
    /// Multiplicador de empuxo enquanto dura.
    pub thrust_multiplier: f32,
    /// Velocidade mínima garantida ao iniciar (empurrão inicial).
    ///
    /// Sem isto, dobrar parado quase não sairia do lugar: a aceleração
    /// precisa de tempo, e o salto é curto por natureza.
    pub kick_speed: f32,
    /// Intervalo entre vórtices deixados no rastro, em segundos.
    pub vortex_interval: f32,
    /// Raio de cada vórtice.
    pub vortex_radius: f32,
    /// Impulso que o vórtice dá a quem entra (unidades de velocidade).
    pub vortex_boost: f32,
    /// Tempo de vida de cada vórtice, em segundos.
    pub vortex_ttl: f32,
}

/// Dobra do casco base, sem componentes de melhoria.
pub const BASE_WARP: WarpProfile = WarpProfile {
    duration: 1.6,
    thrust_multiplier: 9.0,
    kick_speed: 180.0,
    vortex_interval: 0.18,
    vortex_radius: 26.0,
    vortex_boost: 95.0,
    vortex_ttl: 6.0,
};

/// Modificadores que um componente aplica à dobra.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct WarpMods {
    /// Segundos somados à duração.
    pub duration_bonus: f32,
    /// Multiplicador somado ao empuxo de dobra.
    pub thrust_bonus: f32,
    /// Fração somada ao impulso recebido de vórtices ALHEIOS.
    ///
    /// É o eixo de perseguição: quem investe aqui aproveita melhor o
    /// rastro de quem foge.
    pub vortex_gain: f32,
    /// Segundos somados à vida dos vórtices que a nave cria.
    pub vortex_ttl_bonus: f32,
}

/// Modificadores de dobra de um `templateId`, se houver.
pub fn warp_mods(template_id: &str) -> Option<WarpMods> {
    let m = match template_id {
        // Bobina de dobra: salto mais longo e mais forte.
        "warp_coil" => WarpMods {
            duration_bonus: 0.9,
            thrust_bonus: 4.0,
            vortex_gain: 0.0,
            vortex_ttl_bonus: 0.0,
        },
        // Captador de vórtice: transforma rastro alheio em perseguição.
        "vortex_tap" => WarpMods {
            duration_bonus: 0.0,
            thrust_bonus: 0.0,
            vortex_gain: 0.85,
            vortex_ttl_bonus: 0.0,
        },
        // Estabilizador: rastro dura muito mais — bom para equipe.
        "wake_stabilizer" => WarpMods {
            duration_bonus: 0.2,
            thrust_bonus: 0.0,
            vortex_gain: 0.15,
            vortex_ttl_bonus: 7.0,
        },
        _ => return None,
    };
    Some(m)
}

/// Resolve o perfil de dobra de um loadout.
pub fn resolve_warp(template_ids: &[String]) -> (WarpProfile, f32) {
    let mut p = BASE_WARP;
    let mut ganho_vortice = 0.0f32;

    for id in template_ids {
        if let Some(m) = warp_mods(id) {
            p.duration += m.duration_bonus;
            p.thrust_multiplier += m.thrust_bonus;
            p.vortex_ttl += m.vortex_ttl_bonus;
            ganho_vortice += m.vortex_gain;
        }
    }
    // Teto para o salto não virar teleporte: com dois componentes de
    // duração a dobra ainda tem que caber num engajamento.
    p.duration = p.duration.clamp(0.5, 4.0);
    (p, ganho_vortice)
}

/// Um vórtice deixado por um salto de dobra.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Vortex {
    pub pos: [f32; 3],
    /// Direção do impulso (unitária) — a mesma do salto que o criou.
    pub dir: [f32; 3],
    pub radius: f32,
    /// Impulso base entregue a quem entra.
    pub boost: f32,
    pub ttl_remaining: f32,
    /// Vida total com que o vórtice nasceu.
    ///
    /// Guardado no próprio vórtice porque a potência decai com a idade e
    /// quem consulta (servidor e cliente) não tem como saber o perfil de
    /// dobra de quem o criou.
    pub ttl_total: f32,
    /// Quem criou. O próprio criador não se reimpulsiona.
    pub owner_player_id: u32,
}

impl Vortex {
    /// Fração de potência restante: o vórtice enfraquece ao envelhecer.
    ///
    /// Linear e não em degrau para que perseguir logo atrás valha mais
    /// que chegar no fim da vida do rastro.
    pub fn strength(&self) -> f32 {
        if self.ttl_total <= 0.0 {
            return 0.0;
        }
        (self.ttl_remaining / self.ttl_total).clamp(0.0, 1.0)
    }
}

/// Impulso que `vortex` entrega a uma nave em `pos`.
///
/// Devolve `[0,0,0]` fora do raio ou para o próprio criador. O ganho
/// cresce quanto mais perto do centro — passar de raspão dá pouco.
pub fn vortex_impulse(vortex: &Vortex, pos: [f32; 3], player_id: u32, gain: f32) -> [f32; 3] {
    // Quem criou o rastro não ganha carona no próprio rastro: senão
    // dobrar em círculos daria velocidade infinita.
    if vortex.owner_player_id == player_id {
        return [0.0, 0.0, 0.0];
    }

    let dx = pos[0] - vortex.pos[0];
    let dy = pos[1] - vortex.pos[1];
    let dz = pos[2] - vortex.pos[2];
    let dist_sq = dx * dx + dy * dy + dz * dz;
    if dist_sq > vortex.radius * vortex.radius {
        return [0.0, 0.0, 0.0];
    }

    let dist = dist_sq.sqrt();
    let centro = 1.0 - (dist / vortex.radius).clamp(0.0, 1.0);
    let f = vortex.boost * centro * vortex.strength() * (1.0 + gain);

    [vortex.dir[0] * f, vortex.dir[1] * f, vortex.dir[2] * f]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    fn vortice(owner: u32) -> Vortex {
        Vortex {
            pos: [0.0, 0.0, 0.0],
            dir: [0.0, 0.0, 1.0],
            radius: 30.0,
            boost: 100.0,
            ttl_remaining: 6.0,
            ttl_total: 6.0,
            owner_player_id: owner,
        }
    }

    #[test]
    fn dobra_base_e_utilizavel_sem_componentes() {
        let (p, ganho) = resolve_warp(&[]);
        assert_eq!(p, BASE_WARP);
        assert_eq!(ganho, 0.0);
        assert!(p.kick_speed > 0.0, "dobrar parado precisa sair do lugar");
    }

    #[test]
    fn bobina_alonga_e_fortalece_o_salto() {
        let (base, _) = resolve_warp(&[]);
        let (com, _) = resolve_warp(&ids(&["warp_coil"]));
        assert!(com.duration > base.duration);
        assert!(com.thrust_multiplier > base.thrust_multiplier);
    }

    #[test]
    fn captador_melhora_so_o_aproveitamento_alheio() {
        let (p, ganho) = resolve_warp(&ids(&["vortex_tap"]));
        assert!(ganho > 0.0);
        // Não deve alterar o próprio salto.
        assert_eq!(p.duration, BASE_WARP.duration);
        assert_eq!(p.thrust_multiplier, BASE_WARP.thrust_multiplier);
    }

    #[test]
    fn estabilizador_alonga_o_rastro() {
        let (p, _) = resolve_warp(&ids(&["wake_stabilizer"]));
        assert!(p.vortex_ttl > BASE_WARP.vortex_ttl);
    }

    #[test]
    fn duracao_tem_teto() {
        // Empilhar bobinas não pode virar teleporte.
        let (p, _) = resolve_warp(&ids(&["warp_coil", "warp_coil", "warp_coil", "warp_coil"]));
        assert!(p.duration <= 4.0, "duração={}", p.duration);
    }

    #[test]
    fn componentes_desconhecidos_sao_ignorados() {
        let (p, _) = resolve_warp(&ids(&["nao_existe"]));
        assert_eq!(p, BASE_WARP);
    }

    #[test]
    fn vortice_impulsiona_quem_entra() {
        let v = vortice(1);
        let imp = vortex_impulse(&v, [0.0, 0.0, 0.0], 2, 0.0);
        assert!(imp[2] > 0.0, "esperado impulso em +Z, veio {imp:?}");
    }

    #[test]
    fn o_criador_nao_ganha_carona_no_proprio_rastro() {
        // Senão dobrar em círculos daria velocidade infinita.
        let v = vortice(1);
        assert_eq!(vortex_impulse(&v, [0.0, 0.0, 0.0], 1, 0.0), [0.0, 0.0, 0.0]);
    }

    #[test]
    fn fora_do_raio_nao_impulsiona() {
        let v = vortice(1);
        assert_eq!(vortex_impulse(&v, [100.0, 0.0, 0.0], 2, 0.0), [0.0, 0.0, 0.0]);
    }

    #[test]
    fn centro_impulsiona_mais_que_a_borda() {
        let v = vortice(1);
        let centro = vortex_impulse(&v, [0.0, 0.0, 0.0], 2, 0.0)[2];
        let borda = vortex_impulse(&v, [29.0, 0.0, 0.0], 2, 0.0)[2];
        assert!(centro > borda, "centro={centro} borda={borda}");
    }

    #[test]
    fn rastro_velho_impulsiona_menos() {
        // Recompensa perseguir de perto em vez de chegar atrasado.
        let novo = vortice(1);
        let mut velho = vortice(1);
        velho.ttl_remaining = 1.0;
        let a = vortex_impulse(&novo, [0.0, 0.0, 0.0], 2, 0.0)[2];
        let b = vortex_impulse(&velho, [0.0, 0.0, 0.0], 2, 0.0)[2];
        assert!(a > b, "novo={a} velho={b}");
    }

    #[test]
    fn captador_aumenta_o_impulso_recebido() {
        let v = vortice(1);
        let sem = vortex_impulse(&v, [0.0, 0.0, 0.0], 2, 0.0)[2];
        let com = vortex_impulse(&v, [0.0, 0.0, 0.0], 2, 0.85)[2];
        assert!(com > sem * 1.5, "sem={sem} com={com}");
    }

    #[test]
    fn strength_nunca_sai_de_0_1() {
        let mut v = vortice(1);
        v.ttl_remaining = 999.0;
        assert!(v.strength() <= 1.0);
        v.ttl_remaining = -5.0;
        assert!(v.strength() >= 0.0);
        v.ttl_total = 0.0;
        assert_eq!(v.strength(), 0.0);
    }
}
