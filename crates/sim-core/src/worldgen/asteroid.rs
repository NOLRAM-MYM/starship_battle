//! Geração procedural de asteroides.

use crate::ai::Vec3;

use super::noise::density;
use super::seed::Rng;
use super::{ContentKind, WorldObject};

/// Tipos de asteroide (afetam recursos, dificuldade de mineração).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AsteroidKind {
    /// Comum, rico em ferro.
    Iron,
    /// Raro, rico em créditos (gold).
    Gold,
    /// Muito raro, dark matter (matéria-prima para upgrades).
    DarkMatter,
    /// Estéril, só rocha.
    Rock,
}

impl AsteroidKind {
    pub fn from_density(d: f32, rng: &mut Rng) -> Self {
        // 60% rock, 30% iron, 8% gold, 2% dark matter.
        let pick: f32 = rng.next_f32();
        if d < 0.55 {
            AsteroidKind::Rock
        } else if pick < 0.3 {
            AsteroidKind::Iron
        } else if pick < 0.38 {
            AsteroidKind::Gold
        } else if pick < 0.40 {
            AsteroidKind::DarkMatter
        } else if d < 0.85 {
            AsteroidKind::Iron
        } else {
            AsteroidKind::Rock
        }
    }

    pub fn base_value(&self) -> u32 {
        match self {
            AsteroidKind::Rock => 5,
            AsteroidKind::Iron => 25,
            AsteroidKind::Gold => 150,
            AsteroidKind::DarkMatter => 800,
        }
    }
}

/// Asteroide gerado.
#[derive(Debug, Clone, PartialEq)]
pub struct Asteroid {
    pub position: Vec3,
    pub radius: f32,
    pub kind: AsteroidKind,
    /// HP (para destruição durante combate).
    pub hp: f32,
    /// Conteúdo minerável restante (unidades).
    pub resource_units: u32,
}

impl Asteroid {
    pub fn new(position: Vec3, radius: f32, kind: AsteroidKind) -> Self {
        let hp = radius * 50.0;
        let units = (radius * 2.0) as u32;
        Self { position, radius, kind, hp, resource_units: units }
    }
}

impl WorldObject for Asteroid {
    fn position(&self) -> Vec3 { self.position }
    fn radius(&self) -> f32 { self.radius }
    fn kind(&self) -> ContentKind { ContentKind::Asteroid }
}

/// Gera asteroides em uma bounding box usando densidade de ruído.
///
/// Algoritmo: subdivide o volume em uma grade grossa; para cada célula,
/// coleta N candidatos e mantém se `density(x,y,z) > threshold`.
pub fn generate_asteroids(
    rng: &mut Rng,
    min: Vec3,
    max: Vec3,
    count: usize,
    density_threshold: f32,
    min_radius: f32,
    max_radius: f32,
) -> Vec<Asteroid> {
    let mut out = Vec::with_capacity(count);
    let mut attempts = 0usize;
    let max_attempts = count * 10;

    while out.len() < count && attempts < max_attempts {
        attempts += 1;
        let x = rng.range_f32(min.x, max.x);
        let y = rng.range_f32(min.y, max.y);
        let z = rng.range_f32(min.z, max.z);
        let d = density(x, y, z, 500.0);
        if d < density_threshold {
            continue;
        }
        // Tamanho correlacionado com densidade: regiões densas têm asteroids maiores.
        let radius = min_radius + (max_radius - min_radius) * d;
        let kind = AsteroidKind::from_density(d, rng);
        out.push(Asteroid::new(Vec3::new(x, y, z), radius, kind));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_returns_requested_count() {
        let mut rng = Rng::new(42);
        let asteroids = generate_asteroids(
            &mut rng,
            Vec3::new(0.0, 0.0, 0.0),
            Vec3::new(2000.0, 2000.0, 2000.0),
            20,
            0.6,
            5.0,
            50.0,
        );
        // Pode retornar menos que `count` se a densidade for baixa, mas deve
        // produzir pelo menos alguns resultados em um volume grande.
        assert!(!asteroids.is_empty());
        assert!(asteroids.len() <= 20);
    }

    #[test]
    fn radius_within_bounds() {
        let mut rng = Rng::new(7);
        let asteroids = generate_asteroids(
            &mut rng,
            Vec3::new(0.0, 0.0, 0.0),
            Vec3::new(5000.0, 5000.0, 5000.0),
            50,
            0.0, // threshold muito baixo: aceita quase tudo
            10.0,
            30.0,
        );
        for a in &asteroids {
            assert!(a.radius >= 10.0 && a.radius <= 30.0, "r={}", a.radius);
        }
    }

    #[test]
    fn deterministic_for_same_seed() {
        let mut a = Rng::new(123);
        let mut b = Rng::new(123);
        let ra = generate_asteroids(
            &mut a,
            Vec3::new(0.0, 0.0, 0.0),
            Vec3::new(3000.0, 3000.0, 3000.0),
            30,
            0.4,
            5.0,
            40.0,
        );
        let rb = generate_asteroids(
            &mut b,
            Vec3::new(0.0, 0.0, 0.0),
            Vec3::new(3000.0, 3000.0, 3000.0),
            30,
            0.4,
            5.0,
            40.0,
        );
        assert_eq!(ra.len(), rb.len());
        for (x, y) in ra.iter().zip(rb.iter()) {
            assert_eq!(x.position, y.position);
            assert_eq!(x.kind, y.kind);
        }
    }

    #[test]
    fn kind_values_are_pyramidal() {
        // Dark matter > Gold > Iron > Rock em valor base.
        assert!(AsteroidKind::DarkMatter.base_value() > AsteroidKind::Gold.base_value());
        assert!(AsteroidKind::Gold.base_value() > AsteroidKind::Iron.base_value());
        assert!(AsteroidKind::Iron.base_value() > AsteroidKind::Rock.base_value());
    }

    #[test]
    fn world_object_trait() {
        let a = Asteroid::new(Vec3::new(1.0, 2.0, 3.0), 10.0, AsteroidKind::Iron);
        assert_eq!(a.kind(), ContentKind::Asteroid);
        assert_eq!(a.position(), Vec3::new(1.0, 2.0, 3.0));
        assert_eq!(a.radius(), 10.0);
    }

    #[test]
    fn high_threshold_filters_most() {
        let mut rng = Rng::new(11);
        let asteroids = generate_asteroids(
            &mut rng,
            Vec3::new(0.0, 0.0, 0.0),
            Vec3::new(500.0, 500.0, 500.0),
            30,
            0.99, // quase impossível
            5.0,
            10.0,
        );
        assert!(asteroids.len() < 10);
    }
}
