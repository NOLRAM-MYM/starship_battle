-- Catálogo inicial da loja.
--
-- Idempotente: pode rodar em toda subida da API. `ON CONFLICT (code)`
-- atualiza preço/descrição sem duplicar item nem quebrar o inventário
-- de quem já comprou (o id é preservado).
--
-- Os `code` de mod_part batem com os ids do catálogo do estaleiro em
-- `apps/client/src/ui/componentLibrary.ts`. Se um lado mudar sem o outro,
-- o item comprado não aparece para equipar — mantenha os dois em sincronia.

INSERT INTO items (code, kind, name, description, base_price, currency, stackable, metadata) VALUES

-- ---------------------------------------------------------------- Naves
('ship_interceptor', 'ship', 'Interceptador Vagalume',
 'Casco leve de 6 slots. Rápido, frágil, perdoa pouco erro.',
 4500, 'credits', FALSE, '{"chassis":"interceptor","slots":6,"tier":1}'),

('ship_skirmisher', 'ship', 'Escaramuçador Corvo',
 'Equilíbrio entre armamento e mobilidade. O casco padrão da arena.',
 9800, 'credits', FALSE, '{"chassis":"skirmisher","slots":8,"tier":2}'),

('ship_cruiser', 'ship', 'Cruzador Muralha',
 'Casco pesado de 10 slots. Absorve dano que qualquer outro não aguenta.',
 26000, 'credits', FALSE, '{"chassis":"cruiser","slots":10,"tier":4}'),

('ship_hauler', 'ship', 'Cargueiro Bátavo',
 'Porão enorme e blindagem decente. Mineração e logística de clã.',
 18000, 'credits', FALSE, '{"chassis":"hauler","slots":9,"tier":3}'),

-- ---------------------------------------------------------- Habilidades
('skill_dash', 'skill', 'Impulso (Dash)',
 'Arranque instantâneo na direção do nariz. Recarga de 5s.',
 2000, 'credits', FALSE, '{"skillId":"Dash","tier":1}'),

('skill_emp', 'skill', 'Pulso Eletromagnético',
 'Desativa os sistemas de quem estiver perto. Recarga de 10s.',
 7500, 'credits', FALSE, '{"skillId":"Emp","tier":3}'),

('skill_repair', 'skill', 'Reparo de Campo',
 'Recupera casco em combate. Recarga de 15s.',
 6000, 'credits', FALSE, '{"skillId":"Repair","tier":2}'),

-- ------------------------------------------------------ Peças (motores)
('engine_mk1', 'mod_part', 'Motor MK-I',
 'Propulsor de série. Leve, confiável, sem surpresas.',
 250, 'credits', FALSE, '{"templateId":"engine_mk1","tier":1}'),
('engine_mk3', 'mod_part', 'Motor MK-III',
 'Empuxo alto ao custo de massa. Pede casco reforçado.',
 1400, 'credits', FALSE, '{"templateId":"engine_mk3","tier":3}'),
('engine_ion', 'mod_part', 'Propulsor Iônico',
 'Empuxo forte e leve — caro, mas transforma a agilidade.',
 3200, 'credits', FALSE, '{"templateId":"engine_ion","tier":4}'),
('engine_void', 'mod_part', 'Núcleo do Vazio',
 'Protótipo instável. Empuxo absurdo, assinatura enorme.',
 8600, 'dark_matter', FALSE, '{"templateId":"engine_void","tier":5}'),

-- --------------------------------------------------- Peças (dobra)
-- Especializam o motor de dobra da tecla 1. As três atacam eixos
-- diferentes do mesmo sistema, para que a escolha seja de estilo e não
-- de "qual é a melhor": alcance, aproveitar o rastro alheio, ou deixar
-- um rastro melhor para os aliados (e para os inimigos).
('warp_coil', 'mod_part', 'Bobina de Dobra',
 'Salto mais longo e mais forte. Você chega antes; o resto que se vire.',
 2600, 'credits', FALSE, '{"templateId":"warp_coil","tier":3}'),
('vortex_tap', 'mod_part', 'Captador de Vórtice',
 'Aproveita quase o dobro do impulso ao cruzar um rastro alheio. A peça do perseguidor.',
 3800, 'credits', FALSE, '{"templateId":"vortex_tap","tier":4}'),
('wake_stabilizer', 'mod_part', 'Estabilizador de Esteira',
 'Seu rastro dura muito mais. Abre caminho para o esquadrão — e para quem vier atrás.',
 2200, 'credits', FALSE, '{"templateId":"wake_stabilizer","tier":3}'),

-- ------------------------------------------------------- Peças (armas)
('railgun_s', 'mod_part', 'Canhão Linear S',
 'Projétil cinético. Dano moderado, cadência alta.',
 400, 'credits', FALSE, '{"templateId":"railgun_s","tier":1}'),
('laser_burst', 'mod_part', 'Laser em Rajada',
 'Cadência altíssima, dano baixo. Derrete escudos.',
 950, 'credits', FALSE, '{"templateId":"laser_burst","tier":2}'),
('plasma_m', 'mod_part', 'Canhão Plasma M',
 'Salvas pesadas e lentas. Pune quem erra o posicionamento.',
 2100, 'credits', FALSE, '{"templateId":"plasma_m","tier":3}'),
('lance_singular', 'mod_part', 'Lança Singular',
 'Um tiro, uma decisão. Recarga longa, dano devastador.',
 9800, 'dark_matter', FALSE, '{"templateId":"lance_singular","tier":5}'),

-- ----------------------------------------------------- Peças (defesa)
('shield_bio', 'mod_part', 'Escudo Biônico',
 'Barreira equilibrada com regeneração constante.',
 700, 'credits', FALSE, '{"templateId":"shield_bio","tier":2}'),
('shield_phase', 'mod_part', 'Defletor de Fase',
 'Pouca capacidade, regeneração agressiva. Recompensa desengajar.',
 2400, 'credits', FALSE, '{"templateId":"shield_phase","tier":3}'),
('shield_bulwark', 'mod_part', 'Baluarte Pesado',
 'Capacidade enorme, regeneração lenta. Para linha de frente.',
 3900, 'credits', FALSE, '{"templateId":"shield_bulwark","tier":4}'),

-- -------------------------------------------- Peças (sensor/carga/furtiv.)
('sensor_array', 'mod_part', 'Array de Sensores',
 'Varredura básica. Mostra contatos próximos no radar.',
 180, 'credits', FALSE, '{"templateId":"sensor_array","tier":1}'),
('sensor_deep', 'mod_part', 'Varredura Profunda',
 'Enxerga primeiro. Enxergar primeiro decide o combate.',
 1600, 'credits', FALSE, '{"templateId":"sensor_deep","tier":3}'),
('cargo_x2', 'mod_part', 'Expansão de Carga +2',
 'Porão extra para minério e destroços.',
 220, 'credits', FALSE, '{"templateId":"cargo_x2","tier":1}'),
('cargo_hauler', 'mod_part', 'Porão Industrial',
 'Muito espaço, muita massa. Mineração dedicada.',
 1500, 'credits', FALSE, '{"templateId":"cargo_hauler","tier":3}'),
('cloak_lvl1', 'mod_part', 'Camuflagem I',
 'Reduz sua assinatura. Emboscadas ficam viáveis.',
 600, 'credits', FALSE, '{"templateId":"cloak_lvl1","tier":1}'),
('cloak_umbra', 'mod_part', 'Manto Umbra',
 'Quase invisível ao radar — sacrifica escudo pelo silêncio.',
 4400, 'dark_matter', FALSE, '{"templateId":"cloak_umbra","tier":4}'),

-- ------------------------------------------------------- Consumíveis
('repair_kit', 'consumable', 'Kit de Reparo',
 'Restaura 40% do casco fora de combate. Consumido no uso.',
 120, 'credits', TRUE, '{"tier":1}'),
('shield_cell', 'consumable', 'Célula de Escudo',
 'Recarga instantânea do escudo. Uma carga.',
 260, 'credits', TRUE, '{"tier":2}')

ON CONFLICT (code) DO UPDATE SET
  kind        = EXCLUDED.kind,
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  base_price  = EXCLUDED.base_price,
  currency    = EXCLUDED.currency,
  stackable   = EXCLUDED.stackable,
  metadata    = EXCLUDED.metadata;

-- Tudo do catálogo fica à venda com estoque infinito por padrão.
-- Um item sem linha em `shop_items` existe mas não é comprável, o que
-- permite guardar recompensas de quest fora da loja.
INSERT INTO shop_items (item_id, price_mult, stock)
SELECT id, 1.0, NULL FROM items
WHERE kind IN ('ship', 'skill', 'mod_part', 'consumable')
ON CONFLICT (item_id) DO NOTHING;
