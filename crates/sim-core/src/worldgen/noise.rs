//! Value noise 3D determinístico.
//!
//! Gera campos escalares suaves para densidades de objetos. Usa interpolação
//! suave (smoothstep) entre cantos de células. Lattice baseado em hash3
//! (FNV-1a) para garantir paridade servidor/cliente.

use super::seed::hash3;

/// Valor em um canto do lattice (gradiente 1D) baseado em hash.
fn lattice_value(x: i32, y: i32, z: i32) -> f32 {
    // Mapear u32 → [-1, 1].
    let h = hash3(x, y, z);
    (h as f32 / u32::MAX as f32) * 2.0 - 1.0
}

#[inline]
fn smoothstep(t: f32) -> f32 {
    t * t * (3.0 - 2.0 * t)
}

/// Value noise 3D puro (sem fBm).
pub fn value_noise_3d(x: f32, y: f32, z: f32) -> f32 {
    let xi = x.floor() as i32;
    let yi = y.floor() as i32;
    let zi = z.floor() as i32;
    let xf = x - xi as f32;
    let yf = y - yi as f32;
    let zf = z - zi as f32;

    let u = smoothstep(xf);
    let v = smoothstep(yf);
    let w = smoothstep(zf);

    let c000 = lattice_value(xi,     yi,     zi);
    let c100 = lattice_value(xi + 1, yi,     zi);
    let c010 = lattice_value(xi,     yi + 1, zi);
    let c110 = lattice_value(xi + 1, yi + 1, zi);
    let c001 = lattice_value(xi,     yi,     zi + 1);
    let c101 = lattice_value(xi + 1, yi,     zi + 1);
    let c011 = lattice_value(xi,     yi + 1, zi + 1);
    let c111 = lattice_value(xi + 1, yi + 1, zi + 1);

    // Trilinear interpolation.
    let x00 = c000 * (1.0 - u) + c100 * u;
    let x10 = c010 * (1.0 - u) + c110 * u;
    let x01 = c001 * (1.0 - u) + c101 * u;
    let x11 = c011 * (1.0 - u) + c111 * u;
    let y0 = x00 * (1.0 - v) + x10 * v;
    let y1 = x01 * (1.0 - v) + x11 * v;
    y0 * (1.0 - w) + y1 * w
}

/// Fractal Brownian Motion: soma de oitavas.
pub fn fbm_3d(x: f32, y: f32, z: f32, octaves: u32, lacunarity: f32, gain: f32) -> f32 {
    let mut sum = 0.0_f32;
    let mut amp = 1.0_f32;
    let mut freq = 1.0_f32;
    let mut norm = 0.0_f32;
    for _ in 0..octaves.max(1) {
        sum += amp * value_noise_3d(x * freq, y * freq, z * freq);
        norm += amp;
        amp *= gain;
        freq *= lacunarity;
    }
    sum / norm
}

/// Densidade normalizada [0, 1] de objetos em (x, y, z).
pub fn density(x: f32, y: f32, z: f32, scale: f32) -> f32 {
    let n = fbm_3d(x / scale, y / scale, z / scale, 4, 2.0, 0.5);
    (n + 1.0) * 0.5 // [-1,1] → [0,1]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn value_noise_in_range() {
        for i in 0..100 {
            let x = i as f32 * 0.37;
            let v = value_noise_3d(x, x * 1.3, x * 0.7);
            assert!((-1.0..=1.0).contains(&v), "v={}", v);
        }
    }

    #[test]
    fn fbm_in_range() {
        for i in 0..50 {
            let v = fbm_3d(i as f32 * 0.5, 0.0, 0.0, 4, 2.0, 0.5);
            assert!((-1.0..=1.0).contains(&v), "v={}", v);
        }
    }

    #[test]
    fn density_in_unit_range() {
        for i in 0..50 {
            let d = density(i as f32 * 10.0, i as f32 * 7.0, i as f32 * 3.0, 100.0);
            assert!((0.0..=1.0).contains(&d), "d={}", d);
        }
    }

    #[test]
    fn density_same_input_same_output() {
        let d1 = density(123.4, 567.8, 901.2, 50.0);
        let d2 = density(123.4, 567.8, 901.2, 50.0);
        assert_eq!(d1, d2);
    }

    #[test]
    fn smoothstep_endpoints() {
        assert_eq!(smoothstep(0.0), 0.0);
        assert_eq!(smoothstep(1.0), 1.0);
    }
}
