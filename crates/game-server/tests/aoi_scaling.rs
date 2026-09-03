//! Testes da camada de escala multiplayer (protocolo v3).
//!
//! Cobrem as três decisões que definem quantos jogadores cabem num shard:
//! filtragem por raio de interesse, separação estático/dinâmico e o
//! índice player->nave que substituiu a varredura linear por input.

use game_server::net::protocol::{
    AOI_HYSTERESIS, AOI_RADIUS, SNAPSHOT_EVERY_N_TICKS, SNAPSHOT_RATE_HZ, TICK_RATE_HZ,
};
use game_server::world::{
    build_dynamic_snapshot, static_entities_near, Position, World,
};

/// Cria um mundo com uma nave na origem e outra bem longe.
fn world_with_two_ships() -> World {
    let mut w = World::new();
    w.spawn_player_ship(1, "perto".into());
    let far_id = w.spawn_player_ship(2, "longe".into());
    // Empurra a segunda para muito além do raio de interesse.
    if let Some((p, _, _, _)) = w.ships.get_mut(&far_id) {
        p.x = AOI_RADIUS * 4.0;
    }
    w
}

#[test]
fn snapshot_dinamico_exclui_quem_esta_fora_do_raio() {
    let w = world_with_two_ships();
    let near = build_dynamic_snapshot(&w, Position::default(), AOI_RADIUS);
    assert_eq!(
        near.len(),
        1,
        "só a nave dentro do raio deveria entrar no snapshot"
    );
    assert_eq!(near[0].display_name.as_deref(), Some("perto"));
}

#[test]
fn snapshot_dinamico_inclui_tudo_com_raio_grande() {
    let w = world_with_two_ships();
    let all = build_dynamic_snapshot(&w, Position::default(), AOI_RADIUS * 10.0);
    assert_eq!(all.len(), 2, "com raio amplo as duas naves aparecem");
}

#[test]
fn snapshot_dinamico_nao_carrega_entidades_estaticas() {
    // O ponto central da v3: asteroides não podem voltar no snapshot de
    // 20Hz, senão a economia de banda desaparece.
    let mut w = World::new();
    w.spawn_player_ship(1, "p".into());
    w.spawn_asteroid(Position { x: 10.0, y: 0.0, z: 0.0 }, 0, 4.0, 100);

    let dynamic = build_dynamic_snapshot(&w, Position::default(), AOI_RADIUS);
    assert!(
        dynamic.iter().all(|e| e.display_name.as_deref() == Some("p")),
        "snapshot dinâmico não deve conter estáticos: {dynamic:?}"
    );
    assert_eq!(dynamic.len(), 1);

    let statics = static_entities_near(&w, Position::default(), AOI_RADIUS);
    assert_eq!(statics.len(), 1, "o asteroide vem pelo canal de estáticos");
}

#[test]
fn estaticos_respeitam_o_raio() {
    let mut w = World::new();
    w.spawn_asteroid(Position { x: 10.0, y: 0.0, z: 0.0 }, 0, 4.0, 100);
    w.spawn_asteroid(
        Position {
            x: AOI_RADIUS * 3.0,
            y: 0.0,
            z: 0.0,
        },
        0,
        4.0,
        100,
    );

    let near = static_entities_near(&w, Position::default(), AOI_RADIUS);
    assert_eq!(near.len(), 1, "o distante fica fora do lote");
}

#[test]
fn histerese_e_menor_que_o_raio() {
    // A margem de saída precisa ser folga, não um segundo raio: se fosse
    // maior que o próprio AOI, entidades sairiam da visão antes de o
    // cliente sequer recebê-las.
    const { assert!(AOI_HYSTERESIS > 0.0) };
    const { assert!(AOI_HYSTERESIS < AOI_RADIUS) };
}

#[test]
fn taxa_de_snapshot_anunciada_bate_com_a_real() {
    // O cliente usa `SNAPSHOT_RATE_HZ` do Welcome como intervalo de
    // interpolação. Se ele divergir do que o loop realmente envia, o
    // movimento das naves remotas fica aos solavancos.
    assert_eq!(
        TICK_RATE_HZ % SNAPSHOT_RATE_HZ,
        0,
        "a taxa de snapshot precisa dividir a de tick exatamente"
    );
    assert_eq!(
        SNAPSHOT_EVERY_N_TICKS,
        (TICK_RATE_HZ / SNAPSHOT_RATE_HZ) as u64
    );
    // Taxa efetiva = ticks por segundo / ticks entre snapshots.
    let efetiva = TICK_RATE_HZ as u64 / SNAPSHOT_EVERY_N_TICKS;
    assert_eq!(
        efetiva, SNAPSHOT_RATE_HZ as u64,
        "servidor anuncia {SNAPSHOT_RATE_HZ}Hz mas envia {efetiva}Hz"
    );
}

#[test]
fn indice_player_encontra_a_nave_sem_varrer() {
    let mut w = World::new();
    for pid in 0..50u32 {
        w.spawn_player_ship(pid, format!("p{pid}"));
    }
    // O input tem que chegar exatamente na nave do jogador 37.
    w.set_input(37, 1.0, 0.0, 0.0, 1.0, true, 0.0, None, None, false);

    let id = *w.player_ships.get(&37).expect("índice tem o player 37");
    let (_, _, _, ship) = &w.ships[&id];
    assert_eq!(ship.owner_player_id, 37);
    assert_eq!(ship.steer_input, 1.0);
    assert!(ship.pending_fire);

    // Nenhuma outra nave pode ter sido tocada.
    let outras_com_input = w
        .ships
        .values()
        .filter(|(_, _, _, s)| s.owner_player_id != 37 && (s.pending_fire || s.thrust_input > 0.0))
        .count();
    assert_eq!(outras_com_input, 0, "input vazou para outras naves");
}

#[test]
fn input_de_player_inexistente_e_ignorado() {
    let mut w = World::new();
    w.spawn_player_ship(1, "a".into());
    // Não deve entrar em pânico nem afetar ninguém.
    w.set_input(999, 1.0, 0.0, 0.0, 1.0, true, 0.0, None, None, false);
    let (_, _, _, ship) = w.ships.values().next().unwrap();
    assert_eq!(ship.thrust_input, 0.0);
}

#[test]
fn despawn_limpa_indice_e_nave() {
    let mut w = World::new();
    w.spawn_player_ship(5, "sai".into());
    assert!(w.player_ships.contains_key(&5));

    w.despawn_player(5);
    assert!(!w.player_ships.contains_key(&5), "índice ficou órfão");
    assert!(
        w.ships.values().all(|(_, _, _, s)| s.owner_player_id != 5),
        "nave continuou no mundo depois do despawn"
    );
}

#[test]
fn colisao_por_grade_ainda_acerta_o_alvo() {
    // A grade espacial é uma otimização: o resultado observável tem que
    // continuar igual ao do laço O(P.S) que ela substituiu.
    let mut w = World::new();
    let atirador = w.spawn_player_ship(1, "atirador".into());
    let alvo = w.spawn_player_ship(2, "alvo".into());

    // As naves agora nascem espalhadas num anel; reposicionamos as duas
    // para o teste medir só a grade de colisão.
    if let Some((p, _, _, _)) = w.ships.get_mut(&atirador) {
        *p = Position::default();
    }
    if let Some((p, _, _, _)) = w.ships.get_mut(&alvo) {
        *p = Position { x: 0.0, y: 0.0, z: 40.0 };
    }
    // Escudo zerado: o teste é sobre a GRADE de colisão acertar o alvo,
    // não sobre absorção — com escudo, o casco não mudaria.
    if let Some((_, _, _, s)) = w.ships.get_mut(&alvo) {
        s.shield_hp = 0.0;
        s.shield_regen = 0.0;
    }
    let hp_antes = w.ships[&alvo].3.hull_hp;

    w.set_input(1, 0.0, 0.0, 0.0, 0.0, true, 0.0, None, None, false);
    // Tempo suficiente para o projétil percorrer os 40m (100 m/s).
    for _ in 0..30 {
        w.step(1.0 / 30.0);
    }

    let hp_depois = w
        .ships
        .get(&alvo)
        .map(|(_, _, _, s)| s.hull_hp)
        .unwrap_or(0.0);
    assert!(
        hp_depois < hp_antes,
        "o projétil deveria ter acertado o alvo à frente: {hp_antes} -> {hp_depois}"
    );
    assert_eq!(w.ships[&atirador].3.owner_player_id, 1);
}
