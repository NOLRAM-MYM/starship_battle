//! Steering behaviors (Reynolds clássico).
//!
//! Cada função recebe o estado da entidade (`self_pos`, `self_vel`) e o alvo
//! (`target_pos`, `target_vel`) e devolve um vetor de "desejo" / steering,
//! que o FSM combina com pesos e trunca pela aceleração máxima.
//!
//! Todas as funções são puras: `f32 -> f32` sem side-effects.

use super::Vec3;

/// Calcula vetor de seek: aponta para o alvo, com magnitude = max_speed.
pub fn seek(self_pos: Vec3, self_vel: Vec3, target_pos: Vec3, max_speed: f32) -> Vec3 {
    let desired = (target_pos - self_pos).normalized() * max_speed;
    desired - self_vel
}

/// Arrive: desacelera ao chegar no alvo (slowing radius).
pub fn arrive(
    self_pos: Vec3,
    self_vel: Vec3,
    target_pos: Vec3,
    max_speed: f32,
    slowing_radius: f32,
) -> Vec3 {
    let to_target = target_pos - self_pos;
    let dist = to_target.length();
    if dist < 1e-6 {
        return -self_vel;
    }
    let speed = if dist < slowing_radius {
        max_speed * (dist / slowing_radius)
    } else {
        max_speed
    };
    let desired = to_target.normalized() * speed;
    desired - self_vel
}

/// Flee: vetor oposto ao alvo, com magnitude = max_speed.
pub fn flee(self_pos: Vec3, self_vel: Vec3, threat_pos: Vec3, max_speed: f32) -> Vec3 {
    let desired = (self_pos - threat_pos).normalized() * max_speed;
    desired - self_vel
}

/// Wander: pseudo-aleatório usando um "disco" à frente da entidade.
/// `wander_angle` é mantido pelo NPC entre ticks (estado mutável externo).
pub fn wander(self_pos: Vec3, self_vel: Vec3, wander_angle: f32, wander_radius: f32, max_speed: f32) -> Vec3 {
    // Displacement force no ângulo.
    let disp = Vec3::new(wander_radius * wander_angle.cos(), 0.0, wander_radius * wander_angle.sin());
    // Posição alvo = posição + velocidade normalizada (frente) + displacement.
    let forward = if self_vel.length_squared() > 1e-6 {
        self_vel.normalized() * wander_radius
    } else {
        Vec3::new(wander_radius, 0.0, 0.0)
    };
    let target = self_pos + forward + disp;
    seek(self_pos, self_vel, target, max_speed)
}

/// Pursue: antecipa a posição futura do alvo com base em sua velocidade.
pub fn pursue(
    self_pos: Vec3,
    self_vel: Vec3,
    target_pos: Vec3,
    target_vel: Vec3,
    max_speed: f32,
    lookahead_t: f32,
) -> Vec3 {
    let future = target_pos + target_vel * lookahead_t;
    seek(self_pos, self_vel, future, max_speed)
}

/// Evade: oposto ao pursue.
pub fn evade(
    self_pos: Vec3,
    self_vel: Vec3,
    target_pos: Vec3,
    target_vel: Vec3,
    max_speed: f32,
    lookahead_t: f32,
) -> Vec3 {
    let future = target_pos + target_vel * lookahead_t;
    flee(self_pos, self_vel, future, max_speed)
}

/// Soma vários vetores de steering respeitando o `max_accel`.
pub fn combine_and_limit(steerings: &[Vec3], max_accel: f32) -> Vec3 {
    let mut acc = Vec3::ZERO;
    for s in steerings {
        acc += *s;
    }
    acc.truncated(max_accel)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: Vec3, b: Vec3) -> bool {
        (a - b).length() < 1e-3
    }

    #[test]
    fn seek_points_toward_target() {
        let pos = Vec3::new(0.0, 0.0, 0.0);
        let vel = Vec3::ZERO;
        let target = Vec3::new(10.0, 0.0, 0.0);
        let s = seek(pos, vel, target, 5.0);
        // Esperado: +5 em x.
        assert!(approx(s, Vec3::new(5.0, 0.0, 0.0)));
    }

    #[test]
    fn arrive_slows_inside_radius() {
        let pos = Vec3::new(0.0, 0.0, 0.0);
        let vel = Vec3::ZERO;
        let target = Vec3::new(1.0, 0.0, 0.0); // dentro do slowing_radius=10
        let s = arrive(pos, vel, target, 5.0, 10.0);
        // speed = 5 * (1/10) = 0.5 → desired = (1,0,0)*0.5 = (0.5,0,0)
        assert!(approx(s, Vec3::new(0.5, 0.0, 0.0)));
    }

    #[test]
    fn flee_points_away() {
        let pos = Vec3::new(0.0, 0.0, 0.0);
        let vel = Vec3::ZERO;
        let threat = Vec3::new(5.0, 0.0, 0.0);
        let s = flee(pos, vel, threat, 3.0);
        assert!(approx(s, Vec3::new(-3.0, 0.0, 0.0)));
    }

    #[test]
    fn wander_produces_nonzero_steering() {
        let pos = Vec3::new(0.0, 0.0, 0.0);
        let vel = Vec3::new(2.0, 0.0, 0.0);
        let s = wander(pos, vel, 1.57, 1.0, 5.0);
        assert!(s.length() > 0.0);
    }

    #[test]
    fn pursue_ahead_of_target() {
        let pos = Vec3::new(0.0, 0.0, 0.0);
        let vel = Vec3::ZERO;
        let t_pos = Vec3::new(10.0, 0.0, 0.0);
        let t_vel = Vec3::new(0.0, 0.0, 5.0);
        let s = pursue(pos, vel, t_pos, t_vel, 5.0, 1.0);
        // future = (10, 0, 5), target (10,0,0) → heading com +z.
        assert!(s.z > 0.0);
    }

    #[test]
    fn combine_and_limit_caps_acceleration() {
        let s1 = Vec3::new(100.0, 0.0, 0.0);
        let s2 = Vec3::new(0.0, 100.0, 0.0);
        let result = combine_and_limit(&[s1, s2], 10.0);
        assert!((result.length() - 10.0).abs() < 1e-3);
    }
}
