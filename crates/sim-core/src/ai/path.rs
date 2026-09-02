//! Pathfinding A* em grade 2D.
//!
//! A grade é indexada por `(x, y)` em u32. Cada célula é passável ou bloqueada.
//! A heurística é Manhattan (apropriada para movimento em 4 direções).
//!
//! Retorna `Option<Vec<(u32, u32)>>` com a sequência de células do início ao
//! objetivo (inclusivos). Retorna None se o objetivo é inalcançável.
//!
//! Limite: `max_iters` evita travamento em grades densas. Padrão: 10_000.

use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, HashSet};

/// Representa uma célula da grade.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Cell {
    pub x: u32,
    pub y: u32,
}

impl Cell {
    pub const fn new(x: u32, y: u32) -> Self {
        Self { x, y }
    }
}

impl Ord for Cell {
    fn cmp(&self, other: &Self) -> Ordering {
        // Inverte para BinaryHeap ser min-heap por f-cost.
        other.x.cmp(&self.x).then(other.y.cmp(&self.y))
    }
}

impl PartialOrd for Cell {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// Grade de passabilidade: true = bloqueado, false = livre.
#[derive(Debug, Clone)]
pub struct Grid {
    pub width: u32,
    pub height: u32,
    pub blocked: HashSet<Cell>,
}

impl Grid {
    pub fn new(width: u32, height: u32) -> Self {
        Self { width, height, blocked: HashSet::new() }
    }

    pub fn block(&mut self, cell: Cell) {
        if self.in_bounds(cell) {
            self.blocked.insert(cell);
        }
    }

    pub fn unblock(&mut self, cell: Cell) {
        self.blocked.remove(&cell);
    }

    pub fn is_blocked(&self, cell: Cell) -> bool {
        self.blocked.contains(&cell)
    }

    pub fn in_bounds(&self, cell: Cell) -> bool {
        cell.x < self.width && cell.y < self.height
    }

    /// Células vizinhas em 4-conectividade, filtradas por passabilidade.
    pub fn neighbors(&self, cell: Cell) -> Vec<Cell> {
        let mut out = Vec::with_capacity(4);
        if cell.x > 0 {
            let c = Cell::new(cell.x - 1, cell.y);
            if !self.is_blocked(c) {
                out.push(c);
            }
        }
        if cell.x + 1 < self.width {
            let c = Cell::new(cell.x + 1, cell.y);
            if !self.is_blocked(c) {
                out.push(c);
            }
        }
        if cell.y > 0 {
            let c = Cell::new(cell.x, cell.y - 1);
            if !self.is_blocked(c) {
                out.push(c);
            }
        }
        if cell.y + 1 < self.height {
            let c = Cell::new(cell.x, cell.y + 1);
            if !self.is_blocked(c) {
                out.push(c);
            }
        }
        out
    }
}

/// Heurística Manhattan.
fn heuristic(a: Cell, b: Cell) -> u32 {
    let dx = (a.x as i64 - b.x as i64).unsigned_abs();
    let dy = (a.y as i64 - b.y as i64).unsigned_abs();
    // Saturação u32: dx+dy cabe em u32 pois ambos cabem.
    u32::try_from(dx + dy).unwrap_or(u32::MAX)
}

/// Nó interno do A*.
#[derive(Debug, Clone, Copy)]
struct Node {
    cell: Cell,
    g: u32, // custo do início até aqui
    f: u32, // g + heurística
}

impl Eq for Node {}
impl PartialEq for Node {
    fn eq(&self, other: &Self) -> bool {
        self.f == other.f && self.cell == other.cell
    }
}

impl Ord for Node {
    fn cmp(&self, other: &Self) -> Ordering {
        // Inverte: queremos o menor f primeiro.
        other.f.cmp(&self.f)
    }
}

impl PartialOrd for Node {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// Acha o menor caminho entre `start` e `goal` na grade.
/// Retorna a lista de células (inclusiva) ou None se inalcançável.
pub fn astar(grid: &Grid, start: Cell, goal: Cell) -> Option<Vec<Cell>> {
    astar_with_limit(grid, start, goal, 10_000)
}

pub fn astar_with_limit(grid: &Grid, start: Cell, goal: Cell, max_iters: usize) -> Option<Vec<Cell>> {
    if !grid.in_bounds(start) || !grid.in_bounds(goal) {
        return None;
    }
    if grid.is_blocked(start) || grid.is_blocked(goal) {
        return None;
    }
    if start == goal {
        return Some(vec![start]);
    }

    let mut open: BinaryHeap<Node> = BinaryHeap::new();
    let mut came_from: HashMap<Cell, Cell> = HashMap::new();
    let mut g_score: HashMap<Cell, u32> = HashMap::new();

    let h0 = heuristic(start, goal);
    open.push(Node { cell: start, g: 0, f: h0 });
    g_score.insert(start, 0);

    let mut iters = 0usize;
    while let Some(current) = open.pop() {
        if iters >= max_iters {
            return None;
        }
        iters += 1;
        if current.cell == goal {
            // Reconstrói caminho.
            let mut path = vec![goal];
            let mut c = goal;
            while let Some(prev) = came_from.get(&c) {
                path.push(*prev);
                c = *prev;
            }
            path.reverse();
            return Some(path);
        }

        let current_g = *g_score.get(&current.cell).unwrap_or(&u32::MAX);
        if current.g > current_g {
            continue; // entrada obsoleta
        }

        for nb in grid.neighbors(current.cell) {
            let tentative_g = current_g.saturating_add(1);
            let prev_g = *g_score.get(&nb).unwrap_or(&u32::MAX);
            if tentative_g < prev_g {
                came_from.insert(nb, current.cell);
                g_score.insert(nb, tentative_g);
                let f = tentative_g + heuristic(nb, goal);
                open.push(Node { cell: nb, g: tentative_g, f });
            }
        }
    }
    None
}

/// Suaviza um caminho removendo waypoints colineares (redundantes).
/// Útil para visualização e steering (menos pontos a perseguir).
pub fn smooth(path: Vec<Cell>) -> Vec<Cell> {
    if path.len() <= 2 {
        return path;
    }
    let mut out = Vec::with_capacity(path.len());
    out.push(path[0]);
    let mut prev_dir: Option<(i64, i64)> = None;
    for w in path.windows(2) {
        let a = w[0];
        let b = w[1];
        let dir = (b.x as i64 - a.x as i64, b.y as i64 - a.y as i64);
        match prev_dir {
            None => {
                prev_dir = Some(dir);
            }
            Some(pd) => {
                if pd != dir {
                    out.push(a);
                    prev_dir = Some(dir);
                }
            }
        }
    }
    out.push(*path.last().expect("path não vazio"));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn straight_line_horizontal() {
        let g = Grid::new(10, 1);
        let path = astar(&g, Cell::new(0, 0), Cell::new(9, 0)).unwrap();
        assert_eq!(path.len(), 10);
    }

    #[test]
    fn blocked_start_returns_none() {
        let mut g = Grid::new(5, 5);
        g.block(Cell::new(0, 0));
        assert!(astar(&g, Cell::new(0, 0), Cell::new(4, 4)).is_none());
    }

    #[test]
    fn blocked_goal_returns_none() {
        let mut g = Grid::new(5, 5);
        g.block(Cell::new(4, 4));
        assert!(astar(&g, Cell::new(0, 0), Cell::new(4, 4)).is_none());
    }

    #[test]
    fn out_of_bounds_returns_none() {
        let g = Grid::new(5, 5);
        assert!(astar(&g, Cell::new(0, 0), Cell::new(10, 10)).is_none());
    }

    #[test]
    fn walls_force_detour() {
        let mut g = Grid::new(5, 5);
        // Parede vertical em x=2, exceto uma abertura em y=2.
        g.block(Cell::new(2, 0));
        g.block(Cell::new(2, 1));
        g.block(Cell::new(2, 3));
        g.block(Cell::new(2, 4));
        let path = astar(&g, Cell::new(0, 2), Cell::new(4, 2)).unwrap();
        // Deve atravessar por (2,2).
        assert!(path.iter().any(|c| *c == Cell::new(2, 2)));
    }

    #[test]
    fn unreachable_returns_none() {
        let mut g = Grid::new(5, 5);
        // Enclave em (4,4).
        g.block(Cell::new(3, 4));
        g.block(Cell::new(4, 3));
        g.block(Cell::new(4, 4));
        assert!(astar(&g, Cell::new(0, 0), Cell::new(4, 4)).is_none());
    }

    #[test]
    fn start_equals_goal() {
        let g = Grid::new(5, 5);
        let path = astar(&g, Cell::new(2, 2), Cell::new(2, 2)).unwrap();
        assert_eq!(path, vec![Cell::new(2, 2)]);
    }

    #[test]
    fn smooth_removes_colinear_points() {
        let path = vec![
            Cell::new(0, 0),
            Cell::new(1, 0),
            Cell::new(2, 0),
            Cell::new(3, 0),
            Cell::new(3, 1),
            Cell::new(3, 2),
        ];
        let s = smooth(path);
        // Espera-se apenas (0,0), (3,0), (3,2).
        assert_eq!(s.len(), 3);
        assert_eq!(s[0], Cell::new(0, 0));
        assert_eq!(s[1], Cell::new(3, 0));
        assert_eq!(s[2], Cell::new(3, 2));
    }

    #[test]
    fn smooth_short_path_passthrough() {
        assert_eq!(smooth(vec![Cell::new(0, 0), Cell::new(1, 0)]).len(), 2);
        assert_eq!(smooth(vec![Cell::new(0, 0)]).len(), 1);
    }

    #[test]
    fn max_iters_zero_blocks_path() {
        let g = Grid::new(5, 5);
        assert!(astar_with_limit(&g, Cell::new(0, 0), Cell::new(4, 4), 0).is_none());
    }
}
