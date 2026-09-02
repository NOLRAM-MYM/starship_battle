//! PRNG determinístico (Mulberry32) e hash functions.
//!
//! Mulberry32 é pequeno, rápido e tem boa distribuição estatística para
//! jogos (não é seguro para criptografia).

/// Estado do PRNG Mulberry32.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Rng {
    state: u32,
}

impl Rng {
    /// Cria PRNG a partir de uma seed arbitrária.
    pub fn new(seed: u32) -> Self {
        Self { state: seed.max(1) }
    }

    /// PRNG determinístico a partir de uma string (hash FNV-1a).
    /// `#[allow]` porque o nome é intencional: esta é a construção
    /// determinística a partir de uma seed textual, não a conversão
    /// falível de `std::str::FromStr` (nunca falha, não retorna Result).
    #[allow(clippy::should_implement_trait)]
    pub fn from_str(s: &str) -> Self {
        Self::new(fnv1a(s))
    }

    /// Próximo u32 em [0, 2^32).
    pub fn next_u32(&mut self) -> u32 {
        let mut z = self.state.wrapping_add(0x6D2B79F5);
        self.state = z;
        z = (z ^ (z >> 15)).wrapping_mul(z | 1);
        z ^= z.wrapping_add((z ^ (z >> 7)).wrapping_mul(z | 61));
        z ^ (z >> 14)
    }

    /// Próximo f32 em [0, 1).
    pub fn next_f32(&mut self) -> f32 {
        (self.next_u32() >> 8) as f32 / (1u32 << 24) as f32
    }

    /// Próximo f32 em [lo, hi).
    pub fn range_f32(&mut self, lo: f32, hi: f32) -> f32 {
        lo + (hi - lo) * self.next_f32()
    }

    /// Próximo i32 em [lo, hi).
    pub fn range_i32(&mut self, lo: i32, hi: i32) -> i32 {
        let span = (hi - lo).max(1) as u32;
        lo + (self.next_u32() % span) as i32
    }

    /// Boleano com probabilidade `p` ∈ [0, 1].
    pub fn chance(&mut self, p: f32) -> bool {
        self.next_f32() < p
    }

    /// Escolhe índice em slice (None se slice vazio).
    pub fn pick<'a, T>(&mut self, items: &'a [T]) -> Option<&'a T> {
        if items.is_empty() {
            None
        } else {
            Some(&items[self.next_u32() as usize % items.len()])
        }
    }

    /// Mistura 3 i32 em uma seed derivada (para sub-sistemas).
    pub fn derive(&mut self, salt: u32) -> Rng {
        Rng::new(self.next_u32().wrapping_add(salt))
    }
}

/// Hash FNV-1a 32-bit (determinístico e rápido).
pub fn fnv1a(s: &str) -> u32 {
    let mut h: u32 = 0x811C9DC5;
    for b in s.as_bytes() {
        h ^= *b as u32;
        h = h.wrapping_mul(0x01000193);
    }
    h
}

/// Hash de 3 inteiros i32 em u32 (estilo spatial hash).
pub fn hash3(x: i32, y: i32, z: i32) -> u32 {
    let mut h: u32 = 0x811C9DC5;
    for v in [x, y, z] {
        h ^= v as u32;
        h = h.wrapping_mul(0x01000193);
    }
    h
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_seed_same_sequence() {
        let mut a = Rng::new(42);
        let mut b = Rng::new(42);
        for _ in 0..100 {
            assert_eq!(a.next_u32(), b.next_u32());
        }
    }

    #[test]
    fn different_seed_different_sequence() {
        let mut a = Rng::new(1);
        let mut b = Rng::new(2);
        let mut same_count = 0;
        for _ in 0..100 {
            if a.next_u32() == b.next_u32() {
                same_count += 1;
            }
        }
        assert!(same_count < 5); // quase nunca coincidem
    }

    #[test]
    fn range_f32_within_bounds() {
        let mut r = Rng::new(7);
        for _ in 0..1000 {
            let v = r.range_f32(-5.0, 5.0);
            assert!((-5.0..5.0).contains(&v));
        }
    }

    #[test]
    fn chance_distribution() {
        let mut r = Rng::new(99);
        let mut hits = 0;
        let n = 10_000;
        for _ in 0..n {
            if r.chance(0.3) {
                hits += 1;
            }
        }
        // 0.3 ± 0.03 → 2700..3300
        assert!((2700..=3300).contains(&hits), "got {}", hits);
    }

    #[test]
    fn pick_returns_some() {
        let mut r = Rng::new(1);
        let xs = [1, 2, 3, 4, 5];
        for _ in 0..10 {
            assert!(r.pick(&xs).is_some());
        }
        let empty: [i32; 0] = [];
        assert!(r.pick(&empty).is_none());
    }

    #[test]
    fn fnv1a_known_values() {
        // Valores de referência para string vazia.
        assert_eq!(fnv1a(""), 0x811C9DC5);
        // Para "a": 0xE40C292C.
        assert_eq!(fnv1a("a"), 0xE40C292C);
    }

    #[test]
    fn derive_changes_state() {
        let mut a = Rng::new(1);
        let mut b = a.derive(123);
        // Derive produz nova sequência determinística.
        assert_ne!(a.next_u32(), b.next_u32());
    }
}
