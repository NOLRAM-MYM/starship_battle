//! Corpos celestes do setor: estrela, planetas, gigante anelado.
//!
//! Antes estes corpos existiam **apenas no cliente**, gerados por um RNG
//! em TypeScript a partir da seed. Eram cenário puro: bonitos, mas sem
//! efeito nenhum na simulação. Para haver gravidade de verdade o
//! servidor precisa conhecê-los, e os dois lados precisam concordar sobre
//! onde cada um está.
//!
//! A geração passou a viver aqui, em `sim-core`, e o servidor envia a
//! lista pronta ao cliente. Fonte única de verdade: não há um RNG em Rust
//! e outro em TypeScript para sair de sincronia.

use serde::{Deserialize, Serialize};

use super::seed::Rng;

/// Tipo do corpo — define aparência no cliente e massa relativa.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BodyKind {
    /// Estrela central. Massa enorme, luz e calor.
    Star,
    /// Planeta rochoso.
    Planet,
    /// Gigante gasoso (o do setor tem anéis).
    GasGiant,
    /// Lua orbitando um planeta.
    Moon,
    /// Estrela de nêutrons: pequena, densíssima. Poço brutal e estreito.
    NeutronStar,
    /// Buraco negro: não emite luz e engole tudo que entra no horizonte.
    BlackHole,
}

impl BodyKind {
    /// Densidade relativa, usada para derivar massa a partir do raio.
    ///
    /// Estrelas são muito mais densas em termos de efeito gravitacional
    /// para que o poço delas domine o setor, como na realidade.
    pub fn density(self) -> f32 {
        match self {
            BodyKind::Star => 24.0,
            BodyKind::GasGiant => 4.0,
            BodyKind::Planet => 6.0,
            BodyKind::Moon => 3.0,
            // Pequenos, mas com densidade extrema: o poço é estreito e
            // violento, o oposto do gigante gasoso.
            BodyKind::NeutronStar => 220.0,
            BodyKind::BlackHole => 900.0,
        }
    }

    /// Dano por segundo sofrido dentro do raio de captura.
    ///
    /// É o que diferencia *aproximar-se* de uma estrela de aproximar-se
    /// de um planeta: no planeta você só é puxado; na estrela você
    /// derrete antes de chegar.
    pub fn heat_damage(self) -> f32 {
        match self {
            BodyKind::Star => 45.0,
            BodyKind::NeutronStar => 120.0,
            // O buraco negro não queima — ele simplesmente não devolve.
            BodyKind::BlackHole => 0.0,
            _ => 0.0,
        }
    }

    /// Arrasto atmosférico extra dentro do raio de captura (por segundo).
    ///
    /// O gigante gasoso tem atmosfera densa: entrar nela freia a nave,
    /// o que combinado com a gravidade torna a saída bem mais difícil.
    pub fn atmospheric_drag(self) -> f32 {
        match self {
            BodyKind::GasGiant => 0.9,
            BodyKind::Planet => 0.25,
            _ => 0.0,
        }
    }

    /// Multiplicador do raio de influência.
    ///
    /// Corpos compactos concentram a força: o poço da estrela de
    /// nêutrons é curto e mortal, o do gigante é largo e suave.
    pub fn influence_scale(self) -> f32 {
        match self {
            BodyKind::GasGiant => 20.0,
            BodyKind::NeutronStar => 40.0,
            BodyKind::BlackHole => 60.0,
            _ => 14.0,
        }
    }

    /// Nome legível do efeito, para o HUD explicar o que está havendo.
    pub fn hazard_label(self) -> &'static str {
        match self {
            BodyKind::Star => "calor extremo",
            BodyKind::NeutronStar => "radiacao letal",
            BodyKind::BlackHole => "horizonte de eventos",
            BodyKind::GasGiant => "atmosfera densa",
            _ => "",
        }
    }

    pub fn as_u8(self) -> u8 {
        match self {
            BodyKind::Star => 0,
            BodyKind::Planet => 1,
            BodyKind::GasGiant => 2,
            BodyKind::Moon => 3,
            BodyKind::NeutronStar => 4,
            BodyKind::BlackHole => 5,
        }
    }
}

/// Um corpo celeste no setor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CelestialBody {
    /// Id estável dentro do setor.
    pub id: u32,
    pub kind: BodyKind,
    pub name: String,
    pub pos: [f32; 3],
    /// Raio da superfície. Colidir aqui destrói a nave.
    pub radius: f32,
    /// Massa derivada do raio e da densidade do tipo.
    pub mass: f32,
    /// Cor base para o cliente pintar (0xRRGGBB).
    pub color: u32,
    /// Tem anéis? Só o gigante costuma ter.
    pub has_rings: bool,
}

impl CelestialBody {
    /// Raio de influência gravitacional.
    ///
    /// Fora dele a atração é ignorada — não faz sentido (nem é barato)
    /// puxar toda nave do setor em direção a todo planeta. Escala com o
    /// raio para que corpos grandes tenham poços proporcionalmente
    /// maiores.
    pub fn influence_radius(&self) -> f32 {
        self.radius * self.kind.influence_scale()
    }

    /// Altitude a partir da qual a nave é considerada "capturada" —
    /// o HUD avisa e escapar exige empuxo real.
    pub fn capture_radius(&self) -> f32 {
        self.radius * 5.0
    }
}

/// Constante gravitacional do jogo.
///
/// Não é a real (6.674e-11): as escalas aqui são de unidades de jogo.
///
/// Calibrada assim: como `mass = raio² · densidade`, no raio de captura
/// (5·raio) a aceleração vale `G · densidade / 25`, INDEPENDENTE do
/// tamanho do corpo. Com densidade 6 (planeta) e G = 125, isso dá
/// ~30 m/s² — a mesma ordem do empuxo de uma nave equipada (60-260),
/// então escapar exige acelerar de verdade, mas é possível.
///
/// No raio de influência (14·raio) sobra ~4 m/s²: um puxão perceptível
/// que avisa antes de prender. Na superfície passa de 700 m/s², e aí
/// não há escapatória — que é o comportamento desejado.
///
/// O primeiro valor (0.55) vinha de um chute e produzia 0.4 m/s²: a
/// gravidade existia no código e não se sentia no jogo.
pub const GRAVITY_CONSTANT: f32 = 125.0;

/// Aceleração gravitacional que `body` impõe em `pos`.
///
/// Devolve `[0,0,0]` fora do raio de influência. Dentro da superfície,
/// satura no valor da superfície: sem isso a força tenderia ao infinito
/// e a integração explodiria num único tick.
pub fn gravity_at(body: &CelestialBody, pos: [f32; 3]) -> [f32; 3] {
    let dx = body.pos[0] - pos[0];
    let dy = body.pos[1] - pos[1];
    let dz = body.pos[2] - pos[2];
    let dist_sq = dx * dx + dy * dy + dz * dz;

    let influence = body.influence_radius();
    if dist_sq > influence * influence || dist_sq <= f32::EPSILON {
        return [0.0, 0.0, 0.0];
    }

    let dist = dist_sq.sqrt();
    // Piso na distância = raio da superfície. Dentro do corpo a nave já
    // colidiu de qualquer forma; o piso só evita divisão explosiva.
    let effective = dist.max(body.radius);
    let accel = GRAVITY_CONSTANT * body.mass / (effective * effective);

    [
        dx / dist * accel,
        dy / dist * accel,
        dz / dist * accel,
    ]
}

/// Velocidade mínima para escapar do poço a partir de `dist`.
///
/// Usada pelo HUD para mostrar quanto falta. Fórmula clássica
/// `sqrt(2 G M / r)`, com o piso de distância do `gravity_at`.
pub fn escape_speed(body: &CelestialBody, dist: f32) -> f32 {
    let r = dist.max(body.radius);
    (2.0 * GRAVITY_CONSTANT * body.mass / r).sqrt()
}

const PLANET_NAMES: [&str; 12] = [
    "Kepler", "Vega", "Ares", "Thule", "Nyx", "Orpheus", "Iris", "Aurora", "Tellus", "Perseu",
    "Lyra", "Cygnus",
];

const PLANET_COLORS: [u32; 6] = [
    0x8c5a3c, 0x3f6fa8, 0x6f8c5a, 0xa87f3f, 0x7a5aa8, 0x4f8c8c,
];

/// Gera os corpos do setor de forma determinística.
///
/// Mesma seed, mesmo sistema — em qualquer cliente e em qualquer
/// reinício do servidor.
pub fn generate_system(seed: u32) -> Vec<CelestialBody> {
    let mut rng = Rng::new(seed);
    let mut out = Vec::new();
    let mut next_id = 1u32;

    // ---------------- Estrela central ----------------
    let star_radius = 900.0 + rng.next_f32() * 300.0;
    out.push(CelestialBody {
        id: next_id,
        kind: BodyKind::Star,
        name: "Estrela Central".to_string(),
        pos: [
            (rng.next_f32() - 0.5) * 2000.0,
            1200.0 + rng.next_f32() * 800.0,
            -14000.0 - rng.next_f32() * 4000.0,
        ],
        radius: star_radius,
        mass: star_radius * star_radius * BodyKind::Star.density(),
        color: [0xfff0c0, 0xffd08a, 0xc8dcff][(rng.next_f32() * 3.0) as usize % 3],
        has_rings: false,
    });
    next_id += 1;

    // ---------------- Planetas ----------------
    let planet_count = 4;
    for i in 0..planet_count {
        // Distribui em direções distintas: assim cada um serve de
        // referência angular ("o azul fica a leste").
        let angle = (i as f32 / planet_count as f32) * std::f32::consts::TAU + rng.next_f32() * 0.5;
        let dist = 6000.0 + rng.next_f32() * 7000.0;
        let radius = 300.0 + rng.next_f32() * 500.0;
        let is_giant = i == 1;
        let kind = if is_giant { BodyKind::GasGiant } else { BodyKind::Planet };

        let name_idx = (rng.next_f32() * PLANET_NAMES.len() as f32) as usize % PLANET_NAMES.len();
        let color_idx = (rng.next_f32() * PLANET_COLORS.len() as f32) as usize % PLANET_COLORS.len();

        out.push(CelestialBody {
            id: next_id,
            kind,
            name: PLANET_NAMES[name_idx].to_string(),
            pos: [
                angle.cos() * dist,
                (rng.next_f32() - 0.5) * 2500.0,
                angle.sin() * dist,
            ],
            radius,
            mass: radius * radius * kind.density(),
            color: PLANET_COLORS[color_idx],
            has_rings: is_giant,
        });
        next_id += 1;

        // O gigante ganha uma lua — dá um poço gravitacional menor e
        // próximo, bom para manobra.
        if is_giant {
            let moon_r = radius * 0.28;
            let moon_dist = radius * 3.2;
            out.push(CelestialBody {
                id: next_id,
                kind: BodyKind::Moon,
                name: format!("{} I", PLANET_NAMES[name_idx]),
                pos: [
                    angle.cos() * dist + moon_dist,
                    (rng.next_f32() - 0.5) * 200.0,
                    angle.sin() * dist + moon_dist * 0.4,
                ],
                radius: moon_r,
                mass: moon_r * moon_r * BodyKind::Moon.density(),
                color: 0x9aa0a8,
                has_rings: false,
            });
            next_id += 1;
        }
    }

    // ---------------- Corpos exóticos ----------------
    // Um dos dois aparece por setor, longe da rota central: é o marco de
    // maior risco e maior referência visual.
    let exotico = if rng.next_f32() < 0.5 {
        BodyKind::NeutronStar
    } else {
        BodyKind::BlackHole
    };
    let ex_angle = rng.next_f32() * std::f32::consts::TAU;
    let ex_dist = 16000.0 + rng.next_f32() * 6000.0;
    let ex_radius = 60.0 + rng.next_f32() * 60.0;
    out.push(CelestialBody {
        id: next_id,
        kind: exotico,
        name: if exotico == BodyKind::BlackHole {
            "Fenda de Kerr".to_string()
        } else {
            "Pulsar Vela".to_string()
        },
        pos: [
            ex_angle.cos() * ex_dist,
            (rng.next_f32() - 0.5) * 3000.0,
            ex_angle.sin() * ex_dist,
        ],
        radius: ex_radius,
        mass: ex_radius * ex_radius * exotico.density(),
        color: if exotico == BodyKind::BlackHole { 0x120a1e } else { 0xdfe8ff },
        has_rings: exotico == BodyKind::BlackHole,
    });

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn planeta() -> CelestialBody {
        CelestialBody {
            id: 1,
            kind: BodyKind::Planet,
            name: "Teste".into(),
            pos: [0.0, 0.0, 0.0],
            radius: 500.0,
            mass: 500.0 * 500.0 * BodyKind::Planet.density(),
            color: 0,
            has_rings: false,
        }
    }

    #[test]
    fn geracao_e_deterministica() {
        assert_eq!(generate_system(0xC0FFEE), generate_system(0xC0FFEE));
    }

    #[test]
    fn seeds_diferentes_dao_sistemas_diferentes() {
        assert_ne!(generate_system(1), generate_system(2));
    }

    #[test]
    fn sistema_tem_estrela_e_planetas() {
        let s = generate_system(42);
        assert_eq!(s.iter().filter(|b| b.kind == BodyKind::Star).count(), 1);
        assert!(s.iter().filter(|b| b.kind == BodyKind::Planet).count() >= 3);
        assert_eq!(s.iter().filter(|b| b.has_rings).count(), 1);
        // Ids únicos: o cliente indexa por eles.
        let mut ids: Vec<u32> = s.iter().map(|b| b.id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), s.len());
    }

    #[test]
    fn gravidade_zero_fora_da_influencia() {
        let b = planeta();
        let longe = [b.influence_radius() * 2.0, 0.0, 0.0];
        assert_eq!(gravity_at(&b, longe), [0.0, 0.0, 0.0]);
    }

    #[test]
    fn gravidade_aponta_para_o_corpo() {
        let b = planeta();
        let g = gravity_at(&b, [1000.0, 0.0, 0.0]);
        // Está em +X, então a atração tem de ser em -X.
        assert!(g[0] < 0.0, "esperado puxar para -X, veio {g:?}");
        assert!(g[1].abs() < 1e-6 && g[2].abs() < 1e-6);
    }

    #[test]
    fn gravidade_cresce_ao_aproximar() {
        let b = planeta();
        let perto = gravity_at(&b, [800.0, 0.0, 0.0])[0].abs();
        let longe = gravity_at(&b, [3000.0, 0.0, 0.0])[0].abs();
        assert!(perto > longe, "perto={perto} longe={longe}");
    }

    #[test]
    fn gravidade_satura_na_superficie() {
        // Sem o piso de distância, a força tenderia ao infinito e um
        // único tick lançaria a nave para fora do mundo.
        let b = planeta();
        let na_superficie = gravity_at(&b, [b.radius, 0.0, 0.0])[0].abs();
        let dentro = gravity_at(&b, [1.0, 0.0, 0.0])[0].abs();
        assert!(dentro.is_finite());
        assert!(dentro <= na_superficie * 1.001, "dentro={dentro} superficie={na_superficie}");
    }

    #[test]
    fn escapar_exige_mais_velocidade_perto() {
        let b = planeta();
        assert!(escape_speed(&b, 600.0) > escape_speed(&b, 5000.0));
    }

    #[test]
    fn cada_tipo_tem_efeito_proprio() {
        // O ponto do pedido: corpos diferentes agem de forma diferente.
        assert!(BodyKind::Star.heat_damage() > 0.0);
        assert!(BodyKind::NeutronStar.heat_damage() > BodyKind::Star.heat_damage());
        assert_eq!(BodyKind::Planet.heat_damage(), 0.0);

        assert!(BodyKind::GasGiant.atmospheric_drag() > BodyKind::Planet.atmospheric_drag());
        assert_eq!(BodyKind::Star.atmospheric_drag(), 0.0);

        // Compactos concentram: influência relativa maior.
        assert!(BodyKind::BlackHole.influence_scale() > BodyKind::Planet.influence_scale());
    }

    #[test]
    fn corpos_compactos_puxam_muito_mais() {
        let planeta = CelestialBody {
            id: 1, kind: BodyKind::Planet, name: "P".into(), pos: [0.0; 3],
            radius: 100.0, mass: 100.0 * 100.0 * BodyKind::Planet.density(),
            color: 0, has_rings: false,
        };
        let buraco = CelestialBody {
            kind: BodyKind::BlackHole,
            mass: 100.0 * 100.0 * BodyKind::BlackHole.density(),
            ..planeta.clone()
        };
        let p = [500.0, 0.0, 0.0];
        let gp = gravity_at(&planeta, p)[0].abs();
        let gb = gravity_at(&buraco, p)[0].abs();
        assert!(gb > gp * 100.0, "buraco={gb} planeta={gp}");
    }

    #[test]
    fn setor_tem_corpo_exotico() {
        let s = generate_system(99);
        assert!(
            s.iter().any(|b| matches!(b.kind, BodyKind::NeutronStar | BodyKind::BlackHole)),
            "esperado um corpo exótico no setor"
        );
    }

    #[test]
    fn estrela_domina_o_setor() {
        let s = generate_system(7);
        let estrela = s.iter().find(|b| b.kind == BodyKind::Star).unwrap();
        let planeta = s.iter().find(|b| b.kind == BodyKind::Planet).unwrap();
        assert!(estrela.mass > planeta.mass * 10.0);
    }
}
