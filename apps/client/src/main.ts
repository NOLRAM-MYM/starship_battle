import { addEntity, addComponent } from 'bitecs';
import * as THREE from 'three/webgpu';
import { world } from './ecs/world';
import { Transform } from './ecs/components/transform';
import { ShipTag, ShipStats } from './ecs/components/ship';
import { GameRenderer } from './render/Renderer';
import { createSkybox } from './render/Starfield';
import { createVfxSystem } from './render/effects';
import { createVortexField, type VortexState } from './render/VortexField';
import { createHangarStage } from './render/HangarStage';
import { createLandmarks, type LandmarksHandle, type ServerBody } from './render/Landmarks';
import { createGravityViz, type GravityVizHandle } from './render/GravityViz';
import { applyQualityToRig } from './render/lighting';
import { RemoteEntityRenderer } from './render/RemoteEntities';
import { WorldEntityRenderer } from './render/WorldEntityRenderer.js';
import { spinSystem } from './ecs/systems/spin';
import {
  applySnapshot,
  clearRemotes,
  getAllRemoteEntities,
  handleEntityDestroyed,
  getRemoteMeta,
  interpolateRemotes,
} from './ecs/systems/remoteShips';
import {
  applyWorldEntities,
  applyWorldChunk,
  interpolateWorldEntities,
  handleWorldEntityDestroyed as handleWorldEntityDestroyed2,
  clearWorldEntities,
  getAllWorldEntities,
  getWorldEntityMeta,
} from './ecs/systems/worldEntities.js';
import { mountShipBuilder } from './ui/shipBuilder';
import { mountShopScreen } from './ui/ShopScreen';
import { mountKeybindScreen } from './ui/KeybindScreen';
import { connect } from './net/client';
import { chargeMultiplier, primaryWeapon } from './data/weapons';
import { aimBand, aimBandColor, aimBandLabel, solveAim } from './game/aim';
import { gravityTotal } from './game/gravity';
import { fetchProgression, skillNodeIds } from './net/progressionApi';
import { equippedFromInventory } from './data/consumables';
import { fetchInventory, fetchItems } from './net/economyApi';
import { createInputController } from './input/keyboard';
import { startInputLoop } from './input/inputLoop';
import { isXrSupported, requestVrSession, endSession } from './xr/session.js';
import { mountXrToggle } from './ui/xrToggle.js';
import { isMobile } from './input/adaptive.js';
import { TouchController } from './input/touch.js';
import { mountHud, createHudState } from './hud/Hud.js';
import { loadSettings, applySettings } from './ui/settings.js';
import { createAudioBus } from './audio/AudioBus.js';
import { createPerfHud } from './perf/PerfHud.js';
import { cycleTarget, pickTarget, type Contact } from './game/targeting';
import { statsForLoadout, type LoadoutEntry } from './game/shipStats';
import type { NavPoint } from './game/navigation';
import { keyLabel, loadKeymap } from './input/keybindings';
import { componentById } from './ui/componentLibrary';
import { detailFromTiers } from './render/ShipMesh';
import type { ServerMsg } from './net/protocol';
import { LoginScreen } from './ui/LoginScreen';
import { HangarScreen } from './ui/HangarScreen';
import type { ChassisSpec } from './render/ShipMesh';
import './styles/theme.css';

// `127.0.0.1` e não `localhost`: ver a nota em `net/authApi.ts`.
const DEFAULT_WS_URL = 'ws://127.0.0.1:7777';

type AppState = 'LOGIN' | 'HANGAR' | 'PLAY';

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('Canvas #game-canvas not found');

  if (!navigator.gpu) {
    document.body.innerHTML =
      '<h1>Navegador sem suporte a WebGPU. Use Chrome 113+ ou Firefox 121+.</h1>';
    return;
  }

  const renderer = new GameRenderer({ canvas });
  await renderer.init();

  // Cena do hangar: roda desde o login, atrás da UI. Antes o canvas era
  // escondido fora do jogo e as telas ficavam sobre preto liso.
  const hangarStage = createHangarStage();
  hangarStage.setShip({ kind: 'interceptor', hull: 0x28405e, glow: 0x4ec9ff, engines: 2, weapons: 2 });

  /**
   * Sincroniza render e enquadramento com o tamanho REAL do canvas.
   *
   * Fontes de mudança que o evento `resize` sozinho não cobre:
   *  - `ResizeObserver`: o canvas muda sem a janela mudar (barra de
   *    ferramentas do navegador móvel entrando/saindo, split-screen);
   *  - `matchMedia` de resolução: arrastar a janela para um monitor de
   *    densidade diferente altera o devicePixelRatio sem gerar resize.
   */
  function syncViewport(): void {
    const { width, height } = renderer.displaySize();
    renderer.resize(width, height);
    hangarStage.resize(width, height);
  }

  syncViewport();
  window.addEventListener('resize', syncViewport);
  window.addEventListener('orientationchange', syncViewport);

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(syncViewport).observe(canvas);
  }

  // O DPR não dispara evento próprio; observamos a media query da
  // resolução atual e reassinamos a cada mudança.
  let dprQuery: MediaQueryList | null = null;
  const watchDpr = (): void => {
    dprQuery?.removeEventListener('change', onDprChange);
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprQuery.addEventListener('change', onDprChange);
  };
  function onDprChange(): void {
    syncViewport();
    watchDpr();
  }
  watchDpr();

  // ---------------------------------------------------------------- UI
  const settings = loadSettings();
  applySettings(settings);

  const loginScreen = new LoginScreen();

  const hangarRoot = document.createElement('div');
  document.body.appendChild(hangarRoot);
  const hangarScreen = new HangarScreen(hangarRoot);

  const shop = mountShopScreen();
  const keybinds = mountKeybindScreen();
  const builder = mountShipBuilder();

  // Mapa de teclas: físico (`event.code`), então vale em qualquer layout.
  let keymap = loadKeymap();
  builder.setOnPreview((spec) => hangarStage.setShip(spec));

  /**
   * Sincroniza o inventário com o estaleiro: peça não comprada aparece
   * bloqueada. Se a economia estiver fora do ar, passamos `null` e o
   * estaleiro libera tudo — um erro de rede não pode travar a montagem.
   */
  async function syncOwnership(): Promise<void> {
    if (!localStorage.getItem('token')) {
      builder.setOwnedTemplates(null);
      return;
    }
    try {
      await shop.loadOwnership();
      builder.setOwnedTemplates(shop.ownedTemplateIds());
    } catch (err) {
      console.warn('[shop] inventário indisponível, liberando catálogo', err);
      builder.setOwnedTemplates(null);
    }
  }

  shop.setOptions({
    onPurchase: () => {
      // Compra concluída: o estaleiro passa a aceitar a peça na hora.
      builder.setOwnedTemplates(shop.ownedTemplateIds());
    },
    onClose: () => {
      builder.setOwnedTemplates(shop.ownedTemplateIds());
      if (currentState === 'HANGAR' && !builder.isOpen()) void hangarScreen.show();
    },
  });

  builder.setOnRequestShop(() => {
    void shop.open();
  });

  /** Controlador ativo da partida, para reagir a remapeamento na hora. */
  let activeInput: { setKeymap(m: typeof keymap): void } | null = null;

  keybinds.setOptions({
    onChange: (m) => {
      keymap = m;
      activeInput?.setKeymap(m);
    },
    onClose: () => {
      if (currentState === 'HANGAR' && !builder.isOpen() && !shop.isOpen()) {
        void hangarScreen.show();
      }
    },
  });
  // Ao fechar o estaleiro, o hangar reassume a prévia com o loadout salvo.
  builder.setOnClose(() => {
    if (currentState === 'HANGAR') void hangarScreen.show();
  });

  let currentState: AppState = 'LOGIN';

  function setState(
    state: AppState,
    loadoutId?: number | string,
    praticar = false,
  ): void {
    currentState = state;
    // O canvas fica sempre visível: LOGIN e HANGAR mostram a doca 3D.
    canvas!.style.display = 'block';
    if (state === 'LOGIN') {
      loginScreen.show();
      hangarScreen.hide();
      builder.close();
    } else if (state === 'HANGAR') {
      loginScreen.hide();
      void hangarScreen.show();
    } else {
      loginScreen.hide();
      hangarScreen.hide();
      builder.close();
      shop.close();
      keybinds.close();
      startPlay(loadoutId, praticar).catch((err) => console.error('[play] failed', err));
    }
  }

  loginScreen.onLoginSuccess(() => {
    setState('HANGAR');
    void syncOwnership();
  });

  hangarScreen.setCallbacks(
    (loadoutId, practice) => setState('PLAY', loadoutId, practice),
    () => {
      // Abre o estaleiro já com o loadout selecionado carregado, para
      // que "editar" não signifique começar do zero.
      builder.setPilotClass(hangarScreen.getProfile().classId);
      builder.loadSlots(hangarScreen.getSelectedSlots());
      builder.toggle();
    },
    (spec: ChassisSpec) => hangarStage.setShip(spec),
    () => void shop.open(),
    () => keybinds.open(),
    () => {
      const novo = hangarStage.getMode() === 'blueprint' ? 'showcase' : 'blueprint';
      hangarStage.setMode(novo);
      return novo;
    },
  );

  window.addEventListener('keydown', (e) => {
    if (currentState === 'PLAY') return;
    // Fora da partida usamos `code`, coerente com o resto do jogo.
    if (e.code === 'KeyB') builder.toggle();
    if (e.code === 'KeyL') void shop.open();
    if (e.code === 'KeyK') keybinds.open();
    if (e.code === 'Escape') {
      // Fecha o painel mais acima primeiro.
      if (keybinds.isOpen()) keybinds.close();
      else if (shop.isOpen()) shop.close();
      else if (builder.isOpen()) builder.close();
    }
  });
  (globalThis as unknown as { __builder: typeof builder }).__builder = builder;

  const token = localStorage.getItem('token');
  setState(token ? 'HANGAR' : 'LOGIN');
  void syncOwnership();

  // Loop do hangar/login: só roda enquanto não está em jogo.
  let lastMenuFrame = performance.now();
  const menuTick = (): void => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastMenuFrame) / 1000);
    lastMenuFrame = now;
    if (currentState !== 'PLAY') {
      hangarStage.update(dt);
      renderer.render(hangarStage.scene, hangarStage.camera);

      // Rótulos das peças: projeção 3D->2D feita DEPOIS do render, com
      // as matrizes do quadro já atualizadas.
      if (currentState === 'HANGAR' && hangarStage.getMode() === 'blueprint') {
        const { width, height } = renderer.displaySize();
        hangarScreen.updatePartLabels(hangarStage.projectParts(width, height));
      }
    }
    requestAnimationFrame(menuTick);
  };
  requestAnimationFrame(menuTick);

  // -------------------------------------------------------------- JOGO
  let playStarted = false;
  /** Desmonta a partida atual e devolve o jogador ao hangar. */
  let teardownPlay: (() => void) | null = null;

  function returnToHangar(): void {
    if (currentState !== 'PLAY') return;
    teardownPlay?.();
    teardownPlay = null;
    playStarted = false;
    setState('HANGAR');
  }

  /**
   * `practice` entra no campo de provas: o servidor cria alvos de treino
   * ao redor da nave. Mesma arena, mesmas regras — só com adversários
   * previsíveis para conferir mira, torpedo e defesas.
   */
  async function startPlay(loadoutId?: number | string, practice = false): Promise<void> {
    if (playStarted) return;
    playStarted = true;

    const profile = hangarScreen.getProfile();

    const xrSupported = await isXrSupported();
    if (xrSupported) {
      renderer.enableXr();
      const btn = mountXrToggle({
        onEnter: async () => {
          const session = await requestVrSession();
          if (session) await renderer.getXrManager().setSession(session);
        },
        onExit: () => {
          const session = renderer.getXrManager().getSession();
          if (session) endSession(session);
        },
        isSupported: true,
      });
      btn.style.position = 'fixed';
      btn.style.top = '20px';
      btn.style.right = '20px';
      btn.style.zIndex = '1000';
      document.body.appendChild(btn);
    }

    if (isMobile()) {
      const touch = new TouchController({ container: document.body });
      touch.start();
      console.info('[mobile] touch controller active');
    }

    // --- HUD / áudio / performance ---
    const hudState = createHudState();
    hudState.callsign = profile.callsign;

    // Consumíveis ANTES de montar o HUD: os slots são construídos uma
    // vez, na montagem, então preencher depois deixaria a fileira vazia
    // mesmo com cargas no inventário. Falha na API não impede o voo —
    // sem cargas, o jogador entra como entrava antes.
    const cintoEquipado = await Promise.all([fetchInventory(), fetchItems()])
      .then(([inv, itens]) => equippedFromInventory(inv, itens))
      .catch(() => []);
    hudState.consumables = cintoEquipado.map((c) => ({ name: c.nome, charges: c.charges }));
    // Preferência das linhas de gravidade, lembrada entre partidas.
    const LINHAS_KEY = 'batle.gravityLines';
    let linhasLigadas = true;
    try {
      linhasLigadas = localStorage.getItem(LINHAS_KEY) !== 'off';
    } catch {
      // Storage bloqueado: vale o padrão da sessão.
    }

    const alternarLinhas = (): boolean => {
      linhasLigadas = !linhasLigadas;
      gravityViz?.setEnabled(linhasLigadas);
      try {
        localStorage.setItem(LINHAS_KEY, linhasLigadas ? 'on' : 'off');
      } catch {
        // idem
      }
      return linhasLigadas;
    };

    const hud = mountHud({
      container: document.body,
      state: hudState,
      extras: {
        onExit: () => returnToHangar(),
        exitKeyLabel: keyLabel(keymap.toHangar),
        onToggleGravityLines: alternarLinhas,
        gravityKeyLabel: keyLabel(keymap.toggleGravityLines),
        gravityLinesOn: linhasLigadas,
      },
    });
    const audio = createAudioBus({ settings });
    const perfHud = createPerfHud();
    window.addEventListener('keydown', (e) => {
      if (e.key === 'p' && e.ctrlKey) perfHud.toggle();
    });
    void audio;

    // --- Cena de combate ---
    // O preset gráfico corta rim/fill light no 'low': duas luzes a menos
    // por material, que é o que pesa em GPU integrada.
    applyQualityToRig(renderer.lights, settings.graphics);
    const skybox = createSkybox(settings.graphics);
    renderer.scene.add(skybox.group);

    const vfx = createVfxSystem(settings.graphics === 'low' ? 400 : 1200);
    renderer.scene.add(vfx.points);

    // Marcos do setor: sol, planetas, cinturão e meteoros. Gerados do
    // `world_seed` (recebido no Welcome), então todos os clientes do
    // mesmo shard veem o mesmo céu — e nada disso trafega na rede.
    let landmarks: LandmarksHandle | null = null;
    let worldSeed = 0;
    const ensureLandmarks = (seed: number, bodies: readonly ServerBody[]): void => {
      if (landmarks) return;
      landmarks = createLandmarks(seed, settings.graphics, bodies);
      renderer.scene.add(landmarks.group);
      hudState.navPoints = landmarks.list.map(
        (l): NavPoint => ({
          id: l.id,
          name: l.name,
          kind: l.kind,
          position: { x: l.position.x, y: l.position.y, z: l.position.z },
          color: l.color,
        }),
      );
    };

    // Vórtices de dobra: rastro que impulsiona quem entrar.
    const vortexField = createVortexField();
    renderer.scene.add(vortexField.group);
    let vortices: VortexState[] = [];

    const remoteRenderer = new RemoteEntityRenderer(renderer.scene, document.body);
    remoteRenderer.setVfx(vfx);
    // A nave em jogo passa a ser a MESMA que o jogador montou no hangar.
    remoteRenderer.setLocalShipSpec(hangarScreen.getChassisSpec());
    remoteRenderer.setOnLocalHit((severity) => {
      hud.flashDamage(severity);
      renderer.rig.addShake(0.35 + severity * 0.5);
    });
    const worldRenderer = new WorldEntityRenderer(renderer.scene);

    // --- Nave local (ECS) com atributos derivados do loadout + piloto ---
    const slots = hangarScreen.getSelectedSlots() as LoadoutEntry[];
    const derived = statsForLoadout(slots, profile.classId);

    const localEid = addEntity(world);
    addComponent(world, Transform, localEid);
    addComponent(world, ShipTag, localEid);
    addComponent(world, ShipStats, localEid);
    Transform.posX[localEid] = 0;
    Transform.posY[localEid] = 0;
    Transform.posZ[localEid] = 0;
    Transform.scale[localEid] = 1;

    const applyDerived = (s: ReturnType<typeof statsForLoadout>): void => {
      ShipStats.mass[localEid] = s.mass;
      ShipStats.shieldMax[localEid] = s.shield;
      ShipStats.shieldHp[localEid] = s.shield;
      ShipStats.hullMax[localEid] = s.hull;
      ShipStats.hullHp[localEid] = s.hull;
      ShipStats.thrust[localEid] = s.thrust;
      // O HUD lê os máximos daqui; sem isso as barras ficam em 0/100 fixo.
      hudState.hpMax = s.hull;
      hudState.hp = s.hull;
      hudState.shieldMax = s.shield;
      hudState.shield = s.shield;
    };
    applyDerived(derived);

    // Editar o loadout durante a partida reflete nos atributos na hora.
    builder.setOnChange((loadout) => {
      applyDerived(statsForLoadout(loadout as LoadoutEntry[], profile.classId));
    });

    // --- Rede ---
    const wsUrl = (() => {
      const params = new URLSearchParams(window.location.search);
      return params.get('ws') ?? DEFAULT_WS_URL;
    })();
    const playerName = profile.callsign;

    // Skills desbloqueadas: vão no Join junto com o loadout, porque as
    // duas coisas compõem o mesmo tiro. Falha na API não impede o voo —
    // sem skills, valem os números puros do catálogo.
    const progressao = await fetchProgression();
    const skillsDaConta = skillNodeIds(progressao);

    // Consumíveis do inventário. Falha na API não impede o voo — sem
    // cargas, o jogador entra como entrava antes.
    if (skillsDaConta.length > 0) {
      console.info(`[net] ${skillsDaConta.length} skills aplicadas ao combate`);
    }

    const net = connect({
      url: wsUrl,
      name: playerName,
      // Só os ids, em ordem de slot: o servidor resolve os números.
      loadout: slots.map((sl) => sl.templateId),
      skills: skillsDaConta,
      practice,
      consumables: cintoEquipado.map((c) => ({ templateId: c.templateId, charges: c.charges })),
      onStatus: (s) => console.info(`[net] status=${s}`),
    });

    // Alvo travado pelo jogador (Tab). Declarado antes do handler de rede
    // porque `EntityDestroyed` precisa limpá-lo quando o alvo explode.
    let lockedTargetId: number | null = null;

    net.onMessage((msg: ServerMsg) => {
      switch (msg.type) {
        case 'Welcome':
          console.info('[net] welcome', msg.payload);
          (globalThis as { __localPlayerId?: number }).__localPlayerId = msg.payload.player_id;
          // Os corpos chegam na mensagem `Sector`, logo a seguir.
          worldSeed = msg.payload.world_seed;
          hud.toast('Conectado à arena', 'good');
          break;
        case 'Snapshot': {
          const myShip = msg.payload.entities.find(
            (e) => e.kind === 'Ship' && e.display_name === playerName,
          );
          if (myShip) {
            (globalThis as { __localEntityId?: number }).__localEntityId = myShip.id;
          }
          applySnapshot(msg.payload);
          applyWorldEntities(msg.payload);
          // Vórtices vêm no snapshot dinâmico; têm renderizador próprio
          // porque expiram em segundos e são puramente visuais aqui.
          vortices = msg.payload.entities
            .filter((e) => e.kind === 'Vortex' && e.payload?.type === 'Vortex')
            .map((e) => {
              const p = e.payload as { type: 'Vortex'; payload: { dir: [number, number, number]; radius: number; strength: number } };
              return {
                serverId: e.id,
                pos: e.pos,
                dir: p.payload.dir,
                radius: p.payload.radius,
                strength: p.payload.strength,
              };
            });
          break;
        }
        case 'Sector': {
          // Corpos celestes com massa: cenário E física. Só aqui dá para
          // montar os marcos, porque só agora sabemos onde eles estão.
          ensureLandmarks(worldSeed, msg.payload.bodies);
          celestialBodies = msg.payload.bodies;
          constanteG = msg.payload.gravityConstant;
          // As constantes vêm do servidor: a previsão de trajetória usa
          // exatamente a mesma física.
          if (!gravityViz) {
            gravityViz = createGravityViz({
              gravityConstant: msg.payload.gravityConstant,
              shipDrag: msg.payload.shipDrag,
            });
            gravityViz.setEnabled(linhasLigadas);
            renderer.scene.add(gravityViz.group);
          }
          break;
        }
        case 'WorldChunk':
          // Entidades estáticas entrando/saindo do raio de interesse.
          // Chegam uma vez cada, não a cada tick (protocolo v3).
          applyWorldChunk(msg.payload);
          break;
        case 'EntityDestroyed':
          if (msg.payload.entity_id === lockedTargetId) {
            hud.toast('Alvo destruído', 'good');
            lockedTargetId = null;
          }
          handleEntityDestroyed(msg.payload.entity_id);
          handleWorldEntityDestroyed2(msg.payload.entity_id);
          break;
        case 'XpGained': {
          const before = hudState.xp;
          hudState.xp += msg.payload.amount;
          // Detecta a virada de nível comparando antes/depois.
          if (levelOf(before) !== levelOf(hudState.xp)) {
            hud.toast(`Nível ${levelOf(hudState.xp)}`, 'good');
          }
          break;
        }
        case 'SkillActivated': {
          const myEid = (globalThis as { __localEntityId?: number }).__localEntityId;
          if (msg.payload.entity_id === myEid) {
            const skill = hudState.skills.find((s) => s.id === msg.payload.skill);
            if (skill) skill.cooldownEnd = Date.now() + skill.cooldownTotal;
          }
          // A animação vale para QUALQUER nave: antes só o cooldown do
          // próprio jogador reagia, e usar uma habilidade não produzia
          // efeito nenhum na tela — nem para quem usou.
          remoteRenderer.playSkillFx(msg.payload.entity_id, msg.payload.skill);
          break;
        }
        case 'ConsumableUsed': {
          const myEid = (globalThis as { __localEntityId?: number }).__localEntityId;
          if (msg.payload.entityId === myEid) {
            // As cargas vêm do SERVIDOR: ele é quem decide se o uso
            // valeu (cooldown, carga zerada), e um contador local
            // divergiria na primeira recusa.
            const slot = hudState.consumables[msg.payload.slot];
            if (slot) slot.charges = msg.payload.chargesLeft;
          }
          remoteRenderer.playSkillFx(
            msg.payload.entityId,
            msg.payload.vfx === 1 ? 'consumable-shield' : 'consumable-repair',
          );
          break;
        }
        case 'Vfx': {
          // Ids definidos em `net/protocol.rs` (VFX_*). O servidor decide
          // ONDE e O QUÊ; o cliente só desenha.
          const p = new THREE.Vector3(...msg.payload.pos);
          switch (msg.payload.effect_id) {
            case 1: vfx.emit('muzzle', p); break;
            case 2: vfx.emit('impact', p); break;
            case 3:
              vfx.emit('explosion', p);
              renderer.rig.addShake(0.4);
              break;
            case 4:
              // Impacto contra corpo celeste: explosão maior.
              vfx.emit('explosion', p);
              vfx.emit('explosion', p);
              renderer.rig.addShake(0.9);
              break;
            default:
              break;
          }
          break;
        }
        case 'Pong':
          break;
        case 'Error':
          console.error('[net] server error', msg.payload.reason);
          hud.toast(msg.payload.reason, 'bad');
          break;
      }
    });

    // --- Entrada ---
    // Arma primária: alimenta a barra de carga e o rótulo do HUD. Os
    // números vêm do espelho do catálogo do servidor — quem calcula o
    // efeito do tiro continua sendo o servidor.
    const armaPrimaria = primaryWeapon(slots.map((sl) => sl.templateId));
    const tempoDeCarga = armaPrimaria?.tempoDeCarga ?? 0;
    hudState.weaponName = armaPrimaria?.nome ?? null;

    const input = createInputController(keymap);
    input.attach();
    activeInput = input;
    const inputLoop = startInputLoop(net, input, 30, {
      // O torpedo persegue o alvo TRAVADO (Tab). Sem alvo, a tecla não
      // faz nada — o servidor precisa saber em quem.
      lockedTarget: () => lockedTargetId,
    });

    // Tecla de saída, além do botão do HUD.
    input.onAction('toHangar', () => returnToHangar());
    input.onAction('toggleGravityLines', () => {
      hud.setGravityLines(alternarLinhas());
    });
    input.onAction('cycleTarget', () => {
      const next = cycleTarget(lockedTargetId, hudState.position, forward, collectContacts());
      lockedTargetId = next?.id ?? null;
    });

    /**
     * Desmonta a partida por completo.
     *
     * Sem isto, voltar ao hangar deixaria o loop rodando, o socket
     * aberto e a cena cheia de meshes — e uma segunda partida
     * duplicaria tudo.
     */
    const teardown = (): void => {
      inputLoop.stop();
      input.detach();
      activeInput = null;
      clearRemotes();
      remoteRenderer.clear();
      clearWorldEntities();
      worldRenderer.clear();
      renderer.scene.remove(skybox.group);
      skybox.dispose();
      renderer.scene.remove(vfx.points);
      vfx.dispose();
      renderer.scene.remove(vortexField.group);
      vortexField.dispose();
      if (landmarks) {
        renderer.scene.remove(landmarks.group);
        landmarks.dispose();
        landmarks = null;
      }
      if (gravityViz) {
        renderer.scene.remove(gravityViz.group);
        gravityViz.dispose();
        gravityViz = null;
      }
      hud.destroy();
      perfHud.destroy?.();
      net.close();
      running = false;
    };
    teardownPlay = teardown;
    window.addEventListener('beforeunload', teardown);

    // --- Estado do loop ---
    let celestialBodies: readonly ServerBody[] = [];
    // Constante do setor, vinda do servidor. A mira usa exatamente a
    // mesma que a física, senão a curva prevista seria plausível e
    // errada.
    let constanteG = 0.55;
    let gravityViz: GravityVizHandle | null = null;
    const forward = new THREE.Vector3(0, 0, -1);
    // Reaproveitado a cada quadro para projetar o ponto de mira: alocar
    // um Vector3 por quadro pressiona o coletor à toa.
    const miraVec = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    const paraMira = new THREE.Vector3();
    const shipPos = new THREE.Vector3();
    const shipQuat = new THREE.Quaternion();
    const shipVel = new THREE.Vector3();

    /** Contatos visíveis: naves remotas hostis + NPCs. */
    function collectContacts(): Contact[] {
      const out: Contact[] = [];
      const myServerId = (globalThis as { __localEntityId?: number }).__localEntityId;

      for (const eid of getAllRemoteEntities().values()) {
        const m = getRemoteMeta(eid);
        if (!m || m.kind !== 'Ship' || m.serverId === myServerId) continue;
        out.push({
          id: m.serverId,
          name: m.displayName,
          pos: {
            x: Transform.posX[eid] ?? 0,
            y: Transform.posY[eid] ?? 0,
            z: Transform.posZ[eid] ?? 0,
          },
          faction: 'hostile',
          hpRatio: m.hpRatio,
        });
      }

      for (const eid of getAllWorldEntities().values()) {
        const m = getWorldEntityMeta(eid);
        if (!m) continue;
        // Piratas (arquétipo 1) são hostis; patrulhas e mineradores, não.
        const faction: Contact['faction'] =
          m.kind === 'Npc' ? (m.subKind === 1 ? 'hostile' : 'neutral') : 'neutral';
        if (m.kind !== 'Npc' && m.kind !== 'Wreck') continue;
        out.push({
          id: m.serverId,
          name: m.kind === 'Npc' ? npcName(m.subKind) : 'Destroços',
          pos: {
            x: Transform.posX[eid] ?? 0,
            y: Transform.posY[eid] ?? 0,
            z: Transform.posZ[eid] ?? 0,
          },
          faction,
          hpRatio: null,
        });
      }
      return out;
    }

    let last = performance.now();
    let running = true;
    const tick = (): void => {
      // Voltar ao hangar interrompe o laço; sem isso ele continuaria
      // desenhando a cena de combate por cima do menu.
      if (!running) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      // Interpola ANTES de sincronizar as malhas: o servidor manda
      // estado a ~15Hz e desenhamos a 60fps. Sem isto cada posição era
      // repetida por ~4 quadros e o movimento saía aos saltos.
      interpolateRemotes(now, (globalThis as { __localEntityId?: number }).__localEntityId);
      interpolateWorldEntities(now);

      spinSystem(dt);
      // O céu acompanha a câmera (ele é "infinitamente distante").
      skybox.update(dt, renderer.camera.position);
      landmarks?.update(dt, renderer.camera.position);
      vfx.update(dt);
      vortexField.sync(vortices, dt);

      // Fração de carga do gatilho, para a barra do HUD. O tempo de
      // carga vem da arma equipada no SERVIDOR; aqui usamos o do
      // catálogo local só para desenhar a barra.
      const cargaSegs = input.currentCharge();
      const fracao = tempoDeCarga > 0 ? Math.min(1, cargaSegs / tempoDeCarga) : 0;
      hudState.fireCharge = fracao;
      hudState.chargeMult = armaPrimaria ? chargeMultiplier(armaPrimaria, fracao) : 1;
      // A própria nave também acusa a carga: um brilho crescente no
      // cano. Sem isso o único retorno estava numa barra de 4px, e
      // segurar o gatilho parecia não fazer nada.
      remoteRenderer.setLocalCharge(fracao);

      remoteRenderer.sync(dt);
      worldRenderer.sync(dt);

      // --- Localiza a própria nave no snapshot ---
      const myServerId = (globalThis as { __localEntityId?: number }).__localEntityId;
      let myEid: number | undefined;
      if (myServerId !== undefined) {
        for (const eid of getAllRemoteEntities().values()) {
          const m = getRemoteMeta(eid);
          if (m && m.serverId === myServerId) {
            myEid = eid;
            break;
          }
        }
      }

      if (myEid !== undefined) {
        const m = getRemoteMeta(myEid);
        shipPos.set(
          Transform.posX[myEid] ?? 0,
          Transform.posY[myEid] ?? 0,
          Transform.posZ[myEid] ?? 0,
        );
        if (m) {
          shipQuat.set(m.quat[0], m.quat[1], m.quat[2], m.quat[3]);
          shipVel.set(m.vel[0], m.vel[1], m.vel[2]);
          forward.set(0, 0, -1).applyQuaternion(shipQuat);
          if (m.hpRatio !== null) hudState.hp = Math.round(m.hpRatio * hudState.hpMax);
        }

        // Câmera amortecida em vez de posição colada na nave.
        renderer.rig.update(dt, shipPos, shipQuat, shipVel);

        // --- HUD: radar, rumo, alvo ---
        // --- Poço gravitacional ---
        // O servidor já aplica a força; aqui só avisamos, para o jogador
        // entender por que a nave está sendo puxada.
        let poco: { nome: string; dist: number; raio: number } | null = null;
        for (const b of celestialBodies) {
          const d = Math.hypot(b.pos[0] - shipPos.x, b.pos[1] - shipPos.y, b.pos[2] - shipPos.z);
          // Mesmo `capture_radius` do servidor (raio x 5).
          const captura = b.radius * 5;
          if (d <= captura && (!poco || d < poco.dist)) {
            poco = { nome: b.name, dist: d, raio: b.radius };
          }
        }
        if (poco && !hudState.gravityWell) {
          hud.toast(`Gravidade de ${poco.nome} — acelere para escapar`, 'bad');
        }
        hudState.gravityWell = poco
          ? { name: poco.nome, distance: poco.dist, surface: poco.raio }
          : null;

        // Linhas de força e curva prevista.
        gravityViz?.update(
          { x: shipPos.x, y: shipPos.y, z: shipPos.z },
          { x: shipVel.x, y: shipVel.y, z: shipVel.z },
          celestialBodies,
        );


      // --- Torpedos perseguindo o jogador ---
      //
      // Contados a partir do snapshot: o payload traz `locked`, e um
      // torpedo que já perdeu a trava não deve mais alarmar.
      let perseguindo = 0;
      for (const eid of getAllRemoteEntities().values()) {
        const m = getRemoteMeta(eid);
        if (m?.torpedo?.locked) perseguindo += 1;
      }
      hudState.incomingTorpedoes = perseguindo;

        hudState.position = { x: shipPos.x, y: shipPos.y, z: shipPos.z };
        hudState.heading = Math.atan2(forward.x, -forward.z);
        const contacts = collectContacts();
        hudState.contacts = contacts;

        // Alvo travado tem prioridade; senão, mira automática no melhor.
        const locked = lockedTargetId !== null
          ? contacts.find((c) => c.id === lockedTargetId) ?? null
          : null;
        const target = locked ?? pickTarget(hudState.position, forward, contacts);
        if (target) {
          hudState.targetId = target.id;
          hudState.targetName = target.name ?? `Contato ${target.id}`;
          hudState.targetDistance = Math.hypot(
            target.pos.x - shipPos.x,
            target.pos.y - shipPos.y,
            target.pos.z - shipPos.z,
          );
          hudState.targetHp = target.hpRatio ?? 1;
        } else {
          hudState.targetId = null;
          hudState.targetName = null;
        }

      // --- Mira contra o alvo efetivo ---
      //
      // Duas correções que ninguém faz de cabeça: onde o alvo estará
      // quando o projétil chegar, e o quanto a gravidade encurva o tiro
      // no caminho. Ambas dependem do tempo de voo, que depende delas.
      // A conta sai de `game/aim.ts`, que espelha o servidor com fixture
      // dourada — divergir aqui faria a mira apontar errado em silêncio.
      hudState.aim = null;
      // Segue `hudState.targetId`, não `lockedTargetId`: o painel já
      // faz mira automática no melhor contato quando não há trava, e
      // exigir Tab aqui produzia a situação absurda de o HUD mostrar um
      // alvo e a mira simplesmente não existir. Por isso este bloco fica
      // DEPOIS da resolução do alvo, e não antes.
      if (armaPrimaria && target) {
        // A posição vem do CONTATO já resolvido, não de uma nova varredura
        // das naves remotas: o alvo automático também escolhe entidades de
        // mundo (asteroides, destroços), e procurá-lo só entre naves fazia
        // a mira sumir justamente quando o HUD mostrava um alvo.
        //
        // A velocidade só existe para naves; corpos estáticos entram com
        // zero, que é a verdade sobre eles.
        let alvoEid: number | undefined;
        for (const eid of getAllRemoteEntities().values()) {
          const m = getRemoteMeta(eid);
          if (m && m.serverId === target.id) {
            alvoEid = eid;
            break;
          }
        }
        const metaAlvo = alvoEid !== undefined ? getRemoteMeta(alvoEid) : undefined;
        {
          const alvoPos: [number, number, number] = [target.pos.x, target.pos.y, target.pos.z];
          const alvoVel: [number, number, number] = metaAlvo?.vel ?? [0, 0, 0];
          // Gravidade no MEIO do trecho: usar a do atirador subestima a
          // curva quando o alvo está mais fundo no poço, e usar a do
          // alvo superestima quando ele está mais raso.
          const meio = {
            x: (shipPos.x + alvoPos[0]) / 2,
            y: (shipPos.y + alvoPos[1]) / 2,
            z: (shipPos.z + alvoPos[2]) / 2,
          };
          const g = gravityTotal(celestialBodies, meio, constanteG);
          const sol = solveAim({
            shooterPos: [shipPos.x, shipPos.y, shipPos.z],
            shooterVel: [shipVel.x, shipVel.y, shipVel.z],
            targetPos: alvoPos,
            targetVel: alvoVel,
            projectileSpeed: armaPrimaria.velocidade,
            gravity: [g.x, g.y, g.z],
            projectileTtl: armaPrimaria.alcanceSegundos,
          });

          // Só desenha se o ponto estiver À FRENTE da câmera: projetar
          // um ponto atrás dela produz coordenadas espelhadas, e a mira
          // apareceria no lado errado da tela.
          //
          // A checagem é por produto escalar com a direção da câmera, e
          // não pelo `z` do espaço normalizado: com o plano distante em
          // 1e6, todo alvo de combate mapeia para z ≈ 0.999, e um teste
          // `z < 1` fica a um arredondamento de falhar.
          //
          // `updateMatrixWorld` ANTES de projetar não é zelo: `project`
          // usa `matrixWorldInverse`, que só é recalculada dentro de
          // `render()` — e este bloco roda antes. Com a inversa do
          // quadro anterior, a projeção saía fora da faixa [-1,1] (vi
          // ndcX = -108) e a mira ia parar a dezenas de milhares de
          // pixels da tela: presente no DOM, invisível na prática.
          miraVec.set(sol.leadPoint[0], sol.leadPoint[1], sol.leadPoint[2]);
          renderer.camera.updateMatrixWorld();
          camDir.set(0, 0, -1).applyQuaternion(renderer.camera.quaternion);
          paraMira.copy(miraVec).sub(renderer.camera.position);
          const aFrente = paraMira.dot(camDir) > 0;
          miraVec.project(renderer.camera);
          // Fora do frustum lateral: o alvo está no campo, mas a mira
          // caiu atrás da borda da tela.
          // Fora do campo lateral a mira é PRESA À BORDA em vez de
          // sumir. Esconder seria o comportamento óbvio e o errado: o
          // cone de travamento (~102°) é bem mais largo que o campo da
          // câmera (~70°), então o alvo travado passa boa parte do
          // tempo fora da tela — e é justamente aí que o jogador
          // precisa saber para que lado virar.
          const naTela = Math.abs(miraVec.x) <= 1 && Math.abs(miraVec.y) <= 1;
          if (aFrente) {
            const faixa = aimBand(sol.difficulty, sol.reachable);
            const larg = renderer.three.domElement.clientWidth;
            const alt = renderer.three.domElement.clientHeight;
            // Margem para o marcador não ficar meio fora da tela.
            const m = 0.94;
            const nx = naTela ? miraVec.x : Math.max(-m, Math.min(m, miraVec.x));
            const ny = naTela ? miraVec.y : Math.max(-m, Math.min(m, miraVec.y));
            hudState.aim = {
              x: (nx * 0.5 + 0.5) * larg,
              y: (-ny * 0.5 + 0.5) * alt,
              band: faixa,
              label: naTela ? aimBandLabel(faixa) : 'ALVO FORA DA TELA',
              color: aimBandColor(faixa),
              offscreen: !naTela,
            };
          }
        }
      }
      }

      renderer.render();
      hud.refresh();
      perfHud.tick(dt);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    console.info('[play] cena rodando, localEid=', localEid, 'wsUrl=', wsUrl, 'loadoutId=', loadoutId);
  }
}

/** Nome legível do arquétipo de NPC, para o painel de alvo. */
function npcName(archetype: number): string {
  switch (archetype) {
    case 1: return 'Pirata';
    case 2: return 'Patrulha';
    case 3: return 'Minerador';
    default: return 'Contato';
  }
}

/** Nível a partir do XP acumulado (mesma curva do HUD). */
function levelOf(xp: number): number {
  let level = 1;
  let cumulative = 0;
  for (let n = 0; n < 200; n += 1) {
    const cost = Math.round(100 * Math.pow(1.4, n));
    if (cumulative + cost > xp) return n + 1;
    cumulative += cost;
    level = n + 2;
  }
  return level;
}

bootstrap().catch((err) => console.error('[bootstrap] failed', err));
