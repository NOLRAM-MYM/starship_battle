//! Torpedos teleguiados e as formas de escapar deles.
//!
//! Um projétil que persegue sozinho só é bom se houver mais de uma
//! resposta possível. Um torpedo indefensável vira imposto; um que se
//! perde sozinho vira enfeite. Por isso as quatro saídas existem desde o
//! projeto, e cada uma cobra um preço diferente:
//!
//! - **Fuga** — o torpedo tem raio de curva finito e combustível
//!   limitado. Manobrar transversalmente força curvas que ele não fecha,
//!   e correr o faz gastar o tempo de vida. Custa a sua posição no
//!   combate.
//! - **Impulso** — a dobra é rápida demais para o rastreador: passar de
//!   `LOCK_BREAK_SPEED` quebra a trava. Custa o cooldown da habilidade.
//! - **Dispersão** — solta iscas que o rastreador confunde com a nave.
//!   Custa uma carga de consumível.
//! - **Abater** — o torpedo tem casco. Custa acertar um alvo pequeno e
//!   veloz, e o tempo em que você não está atirando em quem lançou.
//!
//! O módulo é puro para que os limites sejam testáveis sem subir o
//! servidor: um torpedo que sempre acerta é um bug de balanceamento tão
//! grave quanto um crash, e bem mais fácil de deixar passar.

use serde::{Deserialize, Serialize};

/// Perfil balístico de um lançador de torpedos.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct TorpedoProfile {
    pub damage: f32,
    /// Velocidade de cruzeiro.
    pub speed: f32,
    /// Aceleração até a velocidade de cruzeiro.
    pub accel: f32,
    /// Quanto ele consegue virar, em radianos por segundo.
    ///
    /// É o número que decide se dá para escapar manobrando: um torpedo
    /// com curva livre seria indefensável.
    pub turn_rate: f32,
    /// Segundos de perseguição antes de perder o combustível.
    pub fuel: f32,
    /// Casco do torpedo — pode ser abatido a tiro.
    pub hp: f32,
    /// Raio de colisão.
    pub radius: f32,
    /// Raio de dano em área no impacto.
    pub splash_radius: f32,
    /// Distância máxima em que consegue adquirir a trava inicial.
    pub lock_range: f32,
}

/// Torpedos do catálogo.
///
/// Os ids batem com `apps/api/src/economy/seed.sql` e
/// `apps/client/src/ui/componentLibrary.ts`.
pub fn torpedo_profile(template_id: &str) -> Option<TorpedoProfile> {
    let p = match template_id {
        // Perseguidor leve: vira bem, mas morre fácil e tem pouco fôlego.
        "torpedo_seeker" => TorpedoProfile {
            damage: 140.0,
            speed: 105.0,
            accel: 90.0,
            turn_rate: 1.5,
            fuel: 7.0,
            hp: 40.0,
            radius: 1.4,
            splash_radius: 16.0,
            lock_range: 900.0,
        },
        // Pesado: dói muito e aguenta tiro, mas vira mal — dá para
        // sair da curva dele se você reagir cedo.
        "torpedo_heavy" => TorpedoProfile {
            damage: 380.0,
            speed: 85.0,
            accel: 55.0,
            turn_rate: 0.8,
            fuel: 10.0,
            hp: 120.0,
            radius: 2.2,
            splash_radius: 32.0,
            lock_range: 1200.0,
        },
        _ => return None,
    };
    Some(p)
}

/// Velocidade acima da qual o rastreador perde a trava.
///
/// Fica logo abaixo da velocidade de dobra (~560 u/s) e bem acima de
/// qualquer voo normal: escapar por velocidade tem que exigir a
/// habilidade, não acontecer por acidente numa reta.
pub const LOCK_BREAK_SPEED: f32 = 400.0;

/// Estado de um torpedo em voo.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Torpedo {
    pub profile: TorpedoProfile,
    pub owner_player_id: u32,
    /// ENTIDADE que lançou.
    ///
    /// `owner_player_id` não basta, pelo mesmo motivo que já valia para
    /// os projéteis: `0` é sentinela de "sem dono humano", e todos os
    /// alvos de treino o compartilham. Sem a identidade da entidade, o
    /// torpedo colidia com o próprio lançador no tick do disparo — ele
    /// nasce 6 unidades à frente de um casco de raio 6.
    pub owner_entity: u32,
    /// Time de quem lançou.
    ///
    /// Carregado no torpedo, e não consultado na nave de origem, porque
    /// ela pode ser destruída durante o voo — e um torpedo órfão não
    /// pode virar de repente uma ameaça para o próprio esquadrão.
    pub owner_team: crate::ship::team::TeamId,
    /// Entidade perseguida. `None` = trava perdida, segue reto.
    pub target: Option<u32>,
    /// Direção atual, unitária.
    pub dir: [f32; 3],
    pub speed: f32,
    pub fuel_remaining: f32,
    pub hp: f32,
}

/// Por que um torpedo deixou de perseguir.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LockLost {
    /// O alvo passou de `LOCK_BREAK_SPEED` (dobra).
    TooFast,
    /// Iscas de dispersão confundiram o rastreador.
    Decoyed,
    /// O alvo saiu do alcance do rastreador.
    OutOfRange,
}

/// Decide se a trava se mantém.
///
/// Reunido numa função só para que as três saídas sejam visíveis lado a
/// lado: espalhadas pelo laço de física, é fácil uma delas parar de
/// funcionar sem ninguém notar.
pub fn check_lock(
    target_speed: f32,
    distance: f32,
    lock_range: f32,
    decoys_nearby: bool,
) -> Result<(), LockLost> {
    if target_speed >= LOCK_BREAK_SPEED {
        return Err(LockLost::TooFast);
    }
    if decoys_nearby {
        return Err(LockLost::Decoyed);
    }
    // Folga de 1.5x: perder a trava no exato limite do alcance faria o
    // torpedo desistir por um metro de diferença, o que parece bug.
    if distance > lock_range * 1.5 {
        return Err(LockLost::OutOfRange);
    }
    Ok(())
}

fn norm(v: [f32; 3]) -> [f32; 3] {
    let l = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if l < 1e-6 {
        return [0.0, 0.0, 1.0];
    }
    [v[0] / l, v[1] / l, v[2] / l]
}

/// Gira `dir` na direção de `desejada`, no máximo `max_rad` radianos.
///
/// O limite é o que torna a fuga possível: sem ele o torpedo colaria no
/// alvo instantaneamente e não haveria manobra que salvasse.
pub fn steer(dir: [f32; 3], desejada: [f32; 3], max_rad: f32) -> [f32; 3] {
    let d = norm(dir);
    let alvo = norm(desejada);
    let cos = (d[0] * alvo[0] + d[1] * alvo[1] + d[2] * alvo[2]).clamp(-1.0, 1.0);
    let ang = cos.acos();
    if ang <= max_rad || ang < 1e-5 {
        return alvo;
    }
    let sin_ang = ang.sin();
    if sin_ang.abs() < 1e-6 {
        // Vetores OPOSTOS (~180°). A interpolação esférica degenera aqui
        // — não existe plano definido entre eles — e a versão anterior
        // devolvia o alvo direto, ou seja, girava 180° num passo. Era o
        // caso em que o limite de curva mais importa: bastava passar
        // pelo torpedo para ele dar meia-volta instantânea e o "escapar
        // manobrando" não existia de fato.
        //
        // Escolhe um eixo perpendicular qualquer e gira o permitido em
        // torno dele: o torpedo começa a fazer o retorno, gastando os
        // segundos que a fuga precisa.
        let eixo = if d[0].abs() < 0.9 {
            [1.0, 0.0, 0.0]
        } else {
            [0.0, 1.0, 0.0]
        };
        // Componente de `eixo` perpendicular a `d`.
        let k = d[0] * eixo[0] + d[1] * eixo[1] + d[2] * eixo[2];
        let perp = norm([
            eixo[0] - d[0] * k,
            eixo[1] - d[1] * k,
            eixo[2] - d[2] * k,
        ]);
        let (c, sn) = (max_rad.cos(), max_rad.sin());
        return norm([
            d[0] * c + perp[0] * sn,
            d[1] * c + perp[1] * sn,
            d[2] * c + perp[2] * sn,
        ]);
    }

    // Interpolação esférica pelo ângulo permitido.
    let t = max_rad / ang;
    let a = ((1.0 - t) * ang).sin() / sin_ang;
    let b = (t * ang).sin() / sin_ang;
    norm([
        d[0] * a + alvo[0] * b,
        d[1] * a + alvo[1] * b,
        d[2] * a + alvo[2] * b,
    ])
}

impl Torpedo {
    pub fn new(
        profile: TorpedoProfile,
        owner_player_id: u32,
        owner_entity: u32,
        owner_team: crate::ship::team::TeamId,
        dir: [f32; 3],
        target: u32,
    ) -> Self {
        Self {
            profile,
            owner_player_id,
            owner_entity,
            owner_team,
            target: Some(target),
            dir: norm(dir),
            // Sai devagar e acelera: dá ao alvo a fração de segundo que
            // torna a reação possível.
            speed: profile.speed * 0.35,
            fuel_remaining: profile.fuel,
            hp: profile.hp,
        }
    }

    /// `true` quando o torpedo deve ser removido.
    pub fn expired(&self) -> bool {
        self.fuel_remaining <= 0.0 || self.hp <= 0.0
    }

    /// Aplica dano; devolve `true` se foi abatido.
    pub fn take_damage(&mut self, dmg: f32) -> bool {
        self.hp -= dmg;
        self.hp <= 0.0
    }

    /// Avança um passo, perseguindo `target_pos` se ainda houver trava.
    pub fn step(&mut self, dt: f32, self_pos: [f32; 3], target_pos: Option<[f32; 3]>) {
        self.fuel_remaining -= dt;
        self.speed = (self.speed + self.profile.accel * dt).min(self.profile.speed);

        // Sem trava, segue reto: continua perigoso por inércia, mas
        // deixa de ser uma sentença.
        let Some(tp) = target_pos else { return };
        if self.target.is_none() {
            return;
        }
        let desejada = [
            tp[0] - self_pos[0],
            tp[1] - self_pos[1],
            tp[2] - self_pos[2],
        ];
        self.dir = steer(self.dir, desejada, self.profile.turn_rate * dt);
    }

    /// Remove a trava.
    pub fn lose_lock(&mut self) {
        self.target = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn perfil() -> TorpedoProfile {
        torpedo_profile("torpedo_seeker").unwrap()
    }

    #[test]
    fn catalogo_conhece_os_dois_torpedos() {
        assert!(torpedo_profile("torpedo_seeker").is_some());
        assert!(torpedo_profile("torpedo_heavy").is_some());
        assert!(torpedo_profile("nao_existe").is_none());
    }

    #[test]
    fn o_pesado_dol_mais_mas_vira_pior() {
        // O trade-off que dá escolha ao jogador: se o pesado fosse
        // melhor em tudo, o leve não teria motivo para existir.
        let leve = torpedo_profile("torpedo_seeker").unwrap();
        let pesado = torpedo_profile("torpedo_heavy").unwrap();
        assert!(pesado.damage > leve.damage);
        assert!(pesado.turn_rate < leve.turn_rate);
        assert!(pesado.hp > leve.hp);
    }

    #[test]
    fn steer_respeita_o_limite_de_curva() {
        // É o número que torna a fuga possível. Sem limite, o torpedo
        // colaria no alvo e nenhuma manobra salvaria.
        let d = [0.0, 0.0, 1.0];
        let oposta = [0.0, 0.0, -1.0];
        let novo = steer(d, oposta, 0.1);
        // Girou só 0.1 rad, não os π necessários.
        let cos = novo[2];
        assert!(cos > 0.99, "girou demais: {novo:?}");
    }

    #[test]
    fn steer_alcanca_o_alvo_quando_o_angulo_cabe() {
        let d = [0.0, 0.0, 1.0];
        let alvo = [0.05, 0.0, 1.0];
        let novo = steer(d, alvo, 1.0);
        let esperado = super::norm(alvo);
        assert!((novo[0] - esperado[0]).abs() < 1e-4);
    }

    #[test]
    fn steer_a_180_graus_gira_so_o_permitido() {
        // O caso degenerado da interpolação esférica, e o mais crítico:
        // se o torpedo desse meia-volta num passo, passar por ele não
        // seria manobra nenhuma.
        let d = [0.0, 0.0, 1.0];
        let oposta = [0.0, 0.0, -1.0];
        let novo = steer(d, oposta, 0.1);
        // cos(0.1) ≈ 0.995: girou 0.1 rad, não π.
        assert!(novo[2] > 0.99, "girou demais: {novo:?}");
        // E de fato girou alguma coisa.
        assert!(novo[2] < 1.0 - 1e-6, "não girou nada: {novo:?}");
    }

    #[test]
    fn steer_com_direcao_degenerada_nao_produz_nan() {
        let novo = steer([0.0, 0.0, 0.0], [0.0, 0.0, 0.0], 0.5);
        assert!(novo.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn dobra_quebra_a_trava() {
        // Defesa 2: impulso.
        assert_eq!(
            check_lock(LOCK_BREAK_SPEED + 1.0, 100.0, 900.0, false),
            Err(LockLost::TooFast)
        );
    }

    #[test]
    fn voo_normal_nao_quebra_a_trava_por_acidente() {
        // 120 u/s é voo rápido comum; escapar tem que exigir a dobra.
        assert!(check_lock(120.0, 100.0, 900.0, false).is_ok());
    }

    #[test]
    fn dispersao_quebra_a_trava() {
        // Defesa 3: iscas.
        assert_eq!(
            check_lock(50.0, 100.0, 900.0, true),
            Err(LockLost::Decoyed)
        );
    }

    #[test]
    fn distancia_grande_quebra_a_trava() {
        // Defesa 1: fuga. A folga de 1.5x evita perder a trava por um
        // metro de diferença no limite do alcance.
        assert!(check_lock(50.0, 1000.0, 900.0, false).is_ok());
        assert_eq!(
            check_lock(50.0, 2000.0, 900.0, false),
            Err(LockLost::OutOfRange)
        );
    }

    #[test]
    fn torpedo_pode_ser_abatido() {
        // Defesa 4: tiro. `hp` finito é o que permite isso.
        let mut t = Torpedo::new(perfil(), 1, 99, 1, [0.0, 0.0, 1.0], 9);
        assert!(!t.take_damage(perfil().hp - 1.0));
        assert!(t.take_damage(2.0));
        assert!(t.expired());
    }

    #[test]
    fn combustivel_acaba_e_o_torpedo_expira() {
        let mut t = Torpedo::new(perfil(), 1, 99, 1, [0.0, 0.0, 1.0], 9);
        for _ in 0..(30 * 8) {
            t.step(1.0 / 30.0, [0.0, 0.0, 0.0], Some([0.0, 0.0, 100.0]));
        }
        assert!(t.expired(), "deveria ter ficado sem combustível");
    }

    #[test]
    fn sem_trava_o_torpedo_segue_reto() {
        let mut t = Torpedo::new(perfil(), 1, 99, 1, [0.0, 0.0, 1.0], 9);
        t.lose_lock();
        let antes = t.dir;
        // Alvo bem a 90°: com trava, viraria.
        t.step(0.5, [0.0, 0.0, 0.0], Some([100.0, 0.0, 0.0]));
        assert_eq!(t.dir, antes, "sem trava não pode corrigir o curso");
    }

    #[test]
    fn com_trava_o_torpedo_vira_na_direcao_do_alvo() {
        let mut t = Torpedo::new(perfil(), 1, 99, 1, [0.0, 0.0, 1.0], 9);
        t.step(0.5, [0.0, 0.0, 0.0], Some([100.0, 0.0, 0.0]));
        assert!(t.dir[0] > 0.0, "deveria ter virado para +X: {:?}", t.dir);
    }

    #[test]
    fn o_torpedo_sai_devagar_e_acelera() {
        // A fração de segundo que torna a reação possível.
        let mut t = Torpedo::new(perfil(), 1, 99, 1, [0.0, 0.0, 1.0], 9);
        let inicial = t.speed;
        assert!(inicial < perfil().speed);
        t.step(1.0, [0.0, 0.0, 0.0], Some([0.0, 0.0, 100.0]));
        assert!(t.speed > inicial);
        // E não passa da velocidade de cruzeiro.
        for _ in 0..10 {
            t.step(1.0, [0.0, 0.0, 0.0], Some([0.0, 0.0, 100.0]));
        }
        assert!(t.speed <= perfil().speed + 1e-3);
    }

    #[test]
    fn manobrar_transversalmente_faz_o_torpedo_errar() {
        // O teste que prova que a FUGA funciona de verdade: um alvo
        // cruzando rápido força curvas que o torpedo não fecha.
        let p = perfil();
        let mut t = Torpedo::new(p, 1, 99, 1, [0.0, 0.0, 1.0], 9);
        let mut pos = [0.0f32, 0.0, 0.0];
        let mut alvo = [0.0f32, 0.0, 300.0];
        let dt = 1.0 / 30.0;
        let mut menor = f32::MAX;

        for _ in 0..(30 * 7) {
            // Alvo cruza em +X a 90 u/s.
            alvo[0] += 90.0 * dt;
            t.step(dt, pos, Some(alvo));
            pos = [
                pos[0] + t.dir[0] * t.speed * dt,
                pos[1] + t.dir[1] * t.speed * dt,
                pos[2] + t.dir[2] * t.speed * dt,
            ];
            let d = ((pos[0] - alvo[0]).powi(2)
                + (pos[1] - alvo[1]).powi(2)
                + (pos[2] - alvo[2]).powi(2))
            .sqrt();
            menor = menor.min(d);
            if t.expired() {
                break;
            }
        }
        assert!(
            menor > p.radius,
            "um alvo manobrando deveria escapar; chegou a {menor}"
        );
    }

    #[test]
    fn alvo_parado_e_atingido() {
        // O contrapeso do teste anterior: se ninguém nunca fosse
        // atingido, o torpedo seria decorativo.
        let p = perfil();
        let mut t = Torpedo::new(p, 1, 99, 1, [0.0, 0.0, 1.0], 9);
        let mut pos = [0.0f32, 0.0, 0.0];
        let alvo = [0.0f32, 0.0, 300.0];
        let dt = 1.0 / 30.0;
        let mut menor = f32::MAX;

        for _ in 0..(30 * 7) {
            t.step(dt, pos, Some(alvo));
            pos = [
                pos[0] + t.dir[0] * t.speed * dt,
                pos[1] + t.dir[1] * t.speed * dt,
                pos[2] + t.dir[2] * t.speed * dt,
            ];
            menor = menor.min(
                ((pos[0] - alvo[0]).powi(2)
                    + (pos[1] - alvo[1]).powi(2)
                    + (pos[2] - alvo[2]).powi(2))
                .sqrt(),
            );
            if t.expired() {
                break;
            }
        }
        assert!(menor < p.radius + 2.0, "alvo parado deveria ser atingido: {menor}");
    }
}
