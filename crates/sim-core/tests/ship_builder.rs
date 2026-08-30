use sim_core::ship::template::{ComponentStats, ComponentTemplate, ShipTemplate};
use sim_core::ship::{build_ship, BuildError, ComponentInstance, ShipLoadout, SlotKind, SlotPos};

fn make_engine(id: &str, thrust: f32) -> ComponentTemplate {
    ComponentTemplate {
        id: id.into(),
        display_name: id.into(),
        kind: SlotKind::Engine,
        tier: 1,
        mass: 10.0,
        power_draw: 5.0,
        stats: ComponentStats { thrust, ..Default::default() },
    }
}

fn make_weapon(id: &str, dmg: f32) -> ComponentTemplate {
    ComponentTemplate {
        id: id.into(),
        display_name: id.into(),
        kind: SlotKind::Weapon,
        tier: 1,
        mass: 20.0,
        power_draw: 30.0,
        stats: ComponentStats { damage: dmg, ..Default::default() },
    }
}

fn make_template() -> ShipTemplate {
    ShipTemplate {
        id: "scout".into(),
        display_name: "Scout".into(),
        base_mass: 100.0,
        base_cargo: 50.0,
        slots: vec![
            SlotPos { id: 1, kind: SlotKind::Engine },
            SlotPos { id: 2, kind: SlotKind::Weapon },
        ],
    }
}

#[test]
fn builds_ship_with_two_components() {
    let tmpl = make_template();
    let loadout = ShipLoadout {
        ship_template_id: "scout".into(),
        components: vec![
            ComponentInstance { template_id: "eng1".into(), slot_id: 1, tier: 1, upgrade_points: 0 },
            ComponentInstance { template_id: "wpn1".into(), slot_id: 2, tier: 1, upgrade_points: 0 },
        ],
    };
    let stats = build_ship(&tmpl, &loadout, |id| match id {
        "eng1" => Some(make_engine("eng1", 100.0)),
        "wpn1" => Some(make_weapon("wpn1", 50.0)),
        _ => None,
    }).unwrap();
    assert_eq!(stats.total_mass, 100.0 + 10.0 + 20.0);
    assert_eq!(stats.thrust, 100.0);
    assert_eq!(stats.damage, 50.0);
}

#[test]
fn rejects_wrong_slot_kind() {
    let tmpl = make_template();
    let loadout = ShipLoadout {
        ship_template_id: "scout".into(),
        components: vec![ComponentInstance {
            template_id: "wpn1".into(), slot_id: 1, tier: 1, upgrade_points: 0,
        }],
    };
    let err = build_ship(&tmpl, &loadout, |_| Some(make_weapon("wpn1", 1.0))).unwrap_err();
    assert!(matches!(err, BuildError::SlotKindMismatch(_, SlotKind::Engine, SlotKind::Weapon)));
}

#[test]
fn rejects_unknown_component() {
    let tmpl = make_template();
    let loadout = ShipLoadout {
        ship_template_id: "scout".into(),
        components: vec![ComponentInstance {
            template_id: "missing".into(), slot_id: 1, tier: 1, upgrade_points: 0,
        }],
    };
    let err = build_ship(&tmpl, &loadout, |_| None).unwrap_err();
    assert!(matches!(err, BuildError::UnknownComponent(_)));
}
