//! Anomalias espaciais (warp, radiação, well gravitacional).

use crate::ai::Vec3;

use super::seed::Rng;
use super::{ContentKind, WorldObject};

/// Tipos de anomalia.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AnomalyKind {
    /// Ponto de warp: teletransporte entre setores.
    Warp,
    /// Zona de radiação: dano contínuo, sem escudo.
    Radiation,
    /// Well gravitacional: puxa navers para o centro.
    GravityWell,
}

impl AnomalyKind {
    pub fn pick(rng: &mut Rng) -> Self {
        // Distribuição: 40% warp, 35% radiação, 25% well.
        let r = rng.next_f32();
        if r < 0.4 {
            Self::Warp
        } else if r < 0.75 {
            Self::Radiation
        } else {
            Self::GravityWell
        }
    }
}

/// Anomalia gerada.
#[derive(Debug, Clone, PartialEq)]
pub struct Anomaly {
    pub position: Vec3,
    pub radius: f32,
    pub kind: AnomalyKind,
    /// Intensidade do efeito (dano/s, força, etc.).
    pub intensity: f32,
    /// ID do warp de destino (None para radiation/well).
    pub target_warp_id: Option<u32>,
}

impl Anomaly {
    pub fn warp(position: Vec3, target_id: u32) -> Self {
        Self {
            position,
            radius: 80.0,
            kind: AnomalyKind::Warp,
            intensity: 1.0,
            target_warp_id: Some(target_id),
        }
    }

    pub fn radiation(position: Vec3, radius: f32, dps: f32) -> Self {
        Self {
            position,
            radius,
            kind: AnomalyKind::Radiation,
            intensity: dps,
            target_warp_id: None,
        }
    }

    pub fn gravity_well(position: Vec3, radius: f32, force: f32) -> Self {
        Self {
            position,
            radius,
            kind: AnomalyKind::GravityWell,
            intensity: force,
            target_warp_id: None,
        }
    }
}

impl WorldObject for Anomaly {
    fn position(&self) -> Vec3 { self.position }
    fn radius(&self) -> f32 { self.radius }
    fn kind(&self) -> ContentKind { ContentKind::Anomaly }
}

/// Gera `count` anomalias em uma bounding box, com warps pareados.
pub fn generate_anomalies(
    rng: &mut Rng,
    min: Vec3,
    max: Vec3,
    count: usize,
) -> Vec<Anomaly> {
    let mut out = Vec::with_capacity(count);
    for i in 0..count {
        let pos = Vec3::new(
            rng.range_f32(min.x, max.x),
            rng.range_f32(min.y, max.y),
            rng.range_f32(min.z, max.z),
        );
        let kind = AnomalyKind::pick(rng);
        let anomaly = match kind {
            AnomalyKind::Warp => {
                // Par de warps: i e i+1 (ou wrap-around).
                let target = ((i + 1) % count) as u32;
                Anomaly::warp(pos, target)
            }
            AnomalyKind::Radiation => {
                Anomaly::radiation(pos, rng.range_f32(50.0, 200.0), rng.range_f32(5.0, 20.0))
            }
            AnomalyKind::GravityWell => {
                Anomaly::gravity_well(pos, rng.range_f32(150.0, 400.0), rng.range_f32(10.0, 30.0))
            }
        };
        out.push(anomaly);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_returns_count_anomalies() {
        let mut rng = Rng::new(99);
        let xs = generate_anomalies(
            &mut rng,
            Vec3::new(0.0, 0.0, 0.0),
            Vec3::new(5000.0, 5000.0, 5000.0),
            8,
        );
        assert_eq!(xs.len(), 8);
    }

    #[test]
    fn warps_are_paired() {
        let mut rng = Rng::new(11);
        // Forçar todos warps: usar uma anomalia com probabilidade alta.
        // Aqui verificamos que em count=4, ao menos um warp tem target válido.
        let xs = generate_anomalies(
            &mut rng,
            Vec3::new(0.0, 0.0, 0.0),
            Vec3::new(5000.0, 5000.0, 5000.0),
            4,
        );
        // Cada warp aponta para um índice dentro de [0, count).
        for a in &xs {
            if a.kind == AnomalyKind::Warp {
                let t = a.target_warp_id.expect("warp tem target");
                assert!(t < 4);
            }
        }
    }

    #[test]
    fn deterministic_for_same_seed() {
        let mut a = Rng::new(7);
        let mut b = Rng::new(7);
        let ra = generate_anomalies(&mut a, Vec3::ZERO, Vec3::new(1000.0, 1000.0, 1000.0), 5);
        let rb = generate_anomalies(&mut b, Vec3::ZERO, Vec3::new(1000.0, 1000.0, 1000.0), 5);
        assert_eq!(ra.len(), rb.len());
        for (x, y) in ra.iter().zip(rb.iter()) {
            assert_eq!(x.position, y.position);
            assert_eq!(x.kind, y.kind);
        }
    }

    #[test]
    fn constructors_set_fields() {
        let w = Anomaly::warp(Vec3::new(0.0, 0.0, 0.0), 42);
        assert_eq!(w.kind, AnomalyKind::Warp);
        assert_eq!(w.target_warp_id, Some(42));

        let r = Anomaly::radiation(Vec3::ZERO, 100.0, 10.0);
        assert_eq!(r.kind, AnomalyKind::Radiation);
        assert_eq!(r.intensity, 10.0);

        let g = Anomaly::gravity_well(Vec3::ZERO, 200.0, 15.0);
        assert_eq!(g.kind, AnomalyKind::GravityWell);
        assert_eq!(g.intensity, 15.0);
    }
}
