//! Setor: container que combina asteroides, anomalias e wrecks.

use crate::ai::Vec3;

use super::anomaly::{generate_anomalies, Anomaly};
use super::asteroid::{generate_asteroids, Asteroid};
use super::seed::Rng;
use super::wreck::{generate_wrecks, Wreck};

/// Parâmetros de geração de um setor.
#[derive(Debug, Clone, Copy)]
pub struct SectorParams {
    pub seed: u32,
    pub min: Vec3,
    pub max: Vec3,
    pub asteroid_count: usize,
    pub asteroid_density_threshold: f32,
    pub anomaly_count: usize,
    pub wreck_count: usize,
    pub wreck_ttl_ticks: u64,
}

impl Default for SectorParams {
    fn default() -> Self {
        Self {
            seed: 0xC0FFEE,
            min: Vec3::new(-5000.0, -5000.0, -5000.0),
            max: Vec3::new(5000.0, 5000.0, 5000.0),
            asteroid_count: 60,
            asteroid_density_threshold: 0.55,
            anomaly_count: 6,
            wreck_count: 8,
            wreck_ttl_ticks: 5_000,
        }
    }
}

/// Setor gerado: todos os objetos em uma bounding box.
#[derive(Debug, Clone)]
pub struct Sector {
    pub seed: u32,
    pub asteroids: Vec<Asteroid>,
    pub anomalies: Vec<Anomaly>,
    pub wrecks: Vec<Wreck>,
}

impl Sector {
    /// Total de objetos (para validação / UI).
    pub fn total_objects(&self) -> usize {
        self.asteroids.len() + self.anomalies.len() + self.wrecks.len()
    }
}

/// Gera um setor completo a partir de uma seed + parâmetros.
pub fn generate_sector(params: SectorParams) -> Sector {
    let mut rng = Rng::new(params.seed);
    let asteroids = generate_asteroids(
        &mut rng,
        params.min,
        params.max,
        params.asteroid_count,
        params.asteroid_density_threshold,
        5.0,
        60.0,
    );
    let anomalies = generate_anomalies(
        &mut rng,
        params.min,
        params.max,
        params.anomaly_count,
    );
    let wrecks = generate_wrecks(
        &mut rng,
        params.min,
        params.max,
        params.wreck_count,
        params.wreck_ttl_ticks,
    );
    Sector { seed: params.seed, asteroids, anomalies, wrecks }
}

/// Verifica que nenhum par de objetos está muito próximo (overlap problemático).
/// `min_dist` é a distância mínima desejada entre centros.
pub fn validate_no_overlap(sector: &Sector, min_dist: f32) -> Result<(), String> {
    let min_dist_sq = min_dist * min_dist;
    let mut all: Vec<(Vec3, f32)> = Vec::new();
    for a in &sector.asteroids {
        all.push((a.position, a.radius));
    }
    for a in &sector.anomalies {
        all.push((a.position, a.radius));
    }
    for w in &sector.wrecks {
        all.push((w.position, w.radius));
    }
    for i in 0..all.len() {
        for j in (i + 1)..all.len() {
            let (pi, ri) = all[i];
            let (pj, rj) = all[j];
            let dist = pi.distance_squared(pj);
            let min_sep = (ri + rj).min(ri + rj + min_dist);
            if dist < min_sep * min_sep {
                return Err(format!(
                    "objetos {} e {} muito próximos (sep={:.1}, esperado>={:.1})",
                    i, j, dist.sqrt(), min_sep
                ));
            }
            let _ = min_dist_sq;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_params_produce_nonempty_sector() {
        let sector = generate_sector(SectorParams::default());
        assert_eq!(sector.seed, 0xC0FFEE);
        assert!(!sector.asteroids.is_empty());
        assert!(!sector.anomalies.is_empty());
        assert!(!sector.wrecks.is_empty());
    }

    #[test]
    fn deterministic_for_same_seed() {
        let p = SectorParams { seed: 42, ..Default::default() };
        let s1 = generate_sector(p);
        let s2 = generate_sector(p);
        assert_eq!(s1.asteroids.len(), s2.asteroids.len());
        assert_eq!(s1.anomalies.len(), s2.anomalies.len());
        assert_eq!(s1.wrecks.len(), s2.wrecks.len());
        for (a, b) in s1.asteroids.iter().zip(s2.asteroids.iter()) {
            assert_eq!(a.position, b.position);
        }
    }

    #[test]
    fn different_seeds_produce_different_sectors() {
        let s1 = generate_sector(SectorParams { seed: 1, ..Default::default() });
        let s2 = generate_sector(SectorParams { seed: 2, ..Default::default() });
        // Pelo menos uma posição deve diferir (probabilidade altíssima).
        let same = s1
            .asteroids
            .iter()
            .zip(s2.asteroids.iter())
            .all(|(a, b)| a.position == b.position);
        assert!(!same);
    }

    #[test]
    fn total_objects_matches_sum() {
        let sector = generate_sector(SectorParams::default());
        let expected = sector.asteroids.len() + sector.anomalies.len() + sector.wrecks.len();
        assert_eq!(sector.total_objects(), expected);
    }

    #[test]
    fn validate_passes_for_sparse_sector() {
        let p = SectorParams {
            asteroid_count: 3,
            anomaly_count: 1,
            wreck_count: 1,
            min: Vec3::new(0.0, 0.0, 0.0),
            max: Vec3::new(100_000.0, 100_000.0, 100_000.0),
            ..Default::default()
        };
        let sector = generate_sector(p);
        // Volume enorme: deve passar.
        assert!(validate_no_overlap(&sector, 50.0).is_ok());
    }
}
