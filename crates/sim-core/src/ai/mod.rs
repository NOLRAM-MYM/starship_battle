//! Módulo de IA de NPCs.
//!
//! Camadas:
//! - `behaviors`: funções puras que produzem vetores de steering (seek, arrive, ...).
//! - `fsm`: máquina de estados finita (idle, patrol, chase, attack, flee, dead).
//! - `path`: pathfinding A* em grade 2D (suporta navmesh simplificado em espaço 3D).
//!
//! Tudo é determinístico e sem dependências externas (apenas `std`).

pub mod behaviors;
pub mod fsm;
pub mod path;

pub use behaviors::*;
pub use fsm::*;
pub use path::*;

/// Vetor 3D f32 usado para posições, velocidades e steering.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Vec3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl Vec3 {
    pub const ZERO: Vec3 = Vec3 { x: 0.0, y: 0.0, z: 0.0 };

    #[inline]
    pub const fn new(x: f32, y: f32, z: f32) -> Self {
        Self { x, y, z }
    }

    #[inline]
    pub fn length(self) -> f32 {
        (self.x * self.x + self.y * self.y + self.z * self.z).sqrt()
    }

    #[inline]
    pub fn length_squared(self) -> f32 {
        self.x * self.x + self.y * self.y + self.z * self.z
    }

    /// Distância euclidiana entre dois pontos.
    #[inline]
    pub fn distance(self, other: Vec3) -> f32 {
        (self - other).length()
    }

    /// Distância ao quadrado (evita sqrt para comparações).
    #[inline]
    pub fn distance_squared(self, other: Vec3) -> f32 {
        (self - other).length_squared()
    }

    /// Retorna vetor normalizado (length = 1) ou ZERO se muito pequeno.
    pub fn normalized(self) -> Vec3 {
        let len = self.length();
        if len > 1e-6 {
            Vec3 { x: self.x / len, y: self.y / len, z: self.z / len }
        } else {
            Vec3::ZERO
        }
    }

    /// Trunca magnitude a `max`.
    pub fn truncated(self, max: f32) -> Vec3 {
        let len_sq = self.length_squared();
        if len_sq > max * max {
            let len = len_sq.sqrt();
            Vec3 { x: self.x / len * max, y: self.y / len * max, z: self.z / len * max }
        } else {
            self
        }
    }
}

impl std::ops::Add for Vec3 {
    type Output = Vec3;
    #[inline]
    fn add(self, rhs: Vec3) -> Vec3 {
        Vec3 { x: self.x + rhs.x, y: self.y + rhs.y, z: self.z + rhs.z }
    }
}

impl std::ops::Sub for Vec3 {
    type Output = Vec3;
    #[inline]
    fn sub(self, rhs: Vec3) -> Vec3 {
        Vec3 { x: self.x - rhs.x, y: self.y - rhs.y, z: self.z - rhs.z }
    }
}

impl std::ops::Mul<f32> for Vec3 {
    type Output = Vec3;
    #[inline]
    fn mul(self, rhs: f32) -> Vec3 {
        Vec3 { x: self.x * rhs, y: self.y * rhs, z: self.z * rhs }
    }
}

impl std::ops::Div<f32> for Vec3 {
    type Output = Vec3;
    #[inline]
    fn div(self, rhs: f32) -> Vec3 {
        Vec3 { x: self.x / rhs, y: self.y / rhs, z: self.z / rhs }
    }
}

impl std::ops::AddAssign for Vec3 {
    #[inline]
    fn add_assign(&mut self, rhs: Vec3) {
        self.x += rhs.x;
        self.y += rhs.y;
        self.z += rhs.z;
    }
}

impl std::ops::SubAssign for Vec3 {
    #[inline]
    fn sub_assign(&mut self, rhs: Vec3) {
        self.x -= rhs.x;
        self.y -= rhs.y;
        self.z -= rhs.z;
    }
}

impl std::ops::Neg for Vec3 {
    type Output = Vec3;
    #[inline]
    fn neg(self) -> Vec3 {
        Vec3 { x: -self.x, y: -self.y, z: -self.z }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vec3_basic_ops() {
        let a = Vec3::new(1.0, 2.0, 3.0);
        let b = Vec3::new(4.0, 5.0, 6.0);
        assert_eq!(a + b, Vec3::new(5.0, 7.0, 9.0));
        assert_eq!(b - a, Vec3::new(3.0, 3.0, 3.0));
        assert_eq!(a * 2.0, Vec3::new(2.0, 4.0, 6.0));
    }

    #[test]
    fn vec3_normalized_zero_returns_zero() {
        assert_eq!(Vec3::ZERO.normalized(), Vec3::ZERO);
    }

    #[test]
    fn vec3_normalized_unit() {
        let v = Vec3::new(3.0, 0.0, 4.0);
        let n = v.normalized();
        assert!((n.length() - 1.0).abs() < 1e-6);
    }

    #[test]
    fn vec3_truncated() {
        let v = Vec3::new(10.0, 0.0, 0.0);
        assert_eq!(v.truncated(5.0), Vec3::new(5.0, 0.0, 0.0));
        assert_eq!(v.truncated(20.0), v);
    }

    #[test]
    fn vec3_distance() {
        let a = Vec3::new(0.0, 0.0, 0.0);
        let b = Vec3::new(3.0, 4.0, 0.0);
        assert!((a.distance(b) - 5.0).abs() < 1e-6);
        assert_eq!(a.distance_squared(b), 25.0);
    }
}
