/**
 * Card do piloto — a identidade do jogador, que antes não existia.
 *
 * O avatar é um SVG gerado a partir do hash do callsign: mesmo nome,
 * mesma cara, em qualquer máquina, sem baixar imagem nenhuma. A classe
 * escolhida aqui alimenta `aggregateStats`, então trocar de piloto
 * muda de verdade como a nave se comporta.
 */

import {
  PILOT_CLASSES,
  avatarTraitsFor,
  pilotClassById,
  DEFAULT_PILOT_CLASS,
  type PilotClass,
  type PilotClassId,
  type PilotProfile,
} from '../data/pilots';

const STORAGE_KEY = 'batle.pilot';

/** Lê o perfil salvo, caindo em defaults sensatos se ausente/corrompido. */
export function loadPilotProfile(fallbackCallsign = 'Piloto'): PilotProfile {
  const base: PilotProfile = {
    callsign: fallbackCallsign,
    classId: DEFAULT_PILOT_CLASS,
    level: 1,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return base;
    const p = parsed as Partial<PilotProfile>;
    return {
      callsign: typeof p.callsign === 'string' && p.callsign ? p.callsign : base.callsign,
      classId: pilotClassById(String(p.classId)) ? (p.classId as PilotClassId) : base.classId,
      level: Number.isFinite(p.level) ? Math.max(1, Math.floor(p.level as number)) : 1,
    };
  } catch {
    // localStorage indisponível (modo privado / storage bloqueado).
    return base;
  }
}

export function savePilotProfile(profile: PilotProfile): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Persistência é conveniência; falhar aqui não pode quebrar o hangar.
  }
}

/**
 * Avatar procedural. Quatro formatos de capacete x seis insígnias x 360
 * matizes = variedade suficiente para dois pilotos raramente coincidirem.
 */
export function pilotAvatarSvg(callsign: string, size = 84): string {
  const t = avatarTraitsFor(callsign);
  const visor = `hsl(${t.hue} 85% 62%)`;
  const visorDim = `hsl(${t.hue} 70% 34%)`;

  // Silhueta do capacete conforme o traço sorteado.
  const helmets = [
    'M14 40a26 26 0 0 1 52 0v18a14 14 0 0 1-14 14H28a14 14 0 0 1-14-14z',
    'M12 44c0-18 12-30 28-30s28 12 28 30v14c0 10-8 16-18 16H30c-10 0-18-6-18-16z',
    'M16 38a24 24 0 0 1 48 0v26c0 6-5 10-11 10H27c-6 0-11-4-11-10z',
    'M14 42c0-16 13-28 26-28s26 12 26 28v12c0 12-9 20-21 20h-10c-12 0-21-8-21-20z',
  ];
  const helmet = helmets[t.helmet] ?? helmets[0];

  // Insígnia no peitoral — formas simples que leem bem em 84px.
  const insignias = [
    '<circle cx="40" cy="86" r="5" fill="currentColor"/>',
    '<rect x="35" y="81" width="10" height="10" fill="currentColor"/>',
    '<polygon points="40,80 46,92 34,92" fill="currentColor"/>',
    '<polygon points="40,79 45,86 40,93 35,86" fill="currentColor"/>',
    '<path d="M33 86h14M40 79v14" stroke="currentColor" stroke-width="3"/>',
    '<circle cx="40" cy="86" r="6" fill="none" stroke="currentColor" stroke-width="3"/>',
  ];
  const insignia = insignias[t.insignia] ?? insignias[0];

  return `
<svg viewBox="0 0 80 100" width="${size}" height="${size * 1.25}" role="img"
     aria-label="Avatar de ${escapeAttr(callsign)}" style="color:${visor}">
  <defs>
    <linearGradient id="pv-${t.hue}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${visor}"/>
      <stop offset="100%" stop-color="${visorDim}"/>
    </linearGradient>
  </defs>
  <!-- ombros -->
  <path d="M10 100v-12c0-9 8-16 18-16h24c10 0 18 7 18 16v12z" fill="#131c2e"/>
  ${insignia}
  <!-- capacete -->
  <path d="${helmet}" fill="#1b2740" stroke="rgba(160,200,255,.35)" stroke-width="1.5"/>
  <!-- visor -->
  <path d="M22 40c4-8 11-12 18-12s14 4 18 12c-4 10-10 15-18 15s-14-5-18-15z"
        fill="url(#pv-${t.hue})" opacity="0.92"/>
  <!-- reflexo -->
  <path d="M27 38c3-4 7-6 11-6" stroke="rgba(255,255,255,.55)" stroke-width="2"
        fill="none" stroke-linecap="round"/>
</svg>`.trim();
}

export interface PilotCardHandle {
  element: HTMLElement;
  /** Reaplica o perfil (após level up ou troca de classe). */
  update(profile: PilotProfile): void;
}

export interface PilotCardOptions {
  profile: PilotProfile;
  /** Chamado quando o jogador escolhe outra classe. */
  onClassChange?: (classId: PilotClassId) => void;
  /** Chamado quando o callsign é editado. */
  onCallsignChange?: (callsign: string) => void;
}

/** Formata um multiplicador como "+18%" / "-15%". */
function pctLabel(mult: number): string {
  const d = Math.round((mult - 1) * 100);
  return `${d > 0 ? '+' : ''}${d}%`;
}

/** Linhas de modificador de uma classe, já legíveis em português. */
export function modifierRows(cls: PilotClass): Array<{ label: string; value: string; good: boolean }> {
  const m = cls.modifiers;
  const named: Array<[keyof typeof m, string]> = [
    ['thrust', 'Empuxo'],
    ['damage', 'Dano'],
    ['fireRate', 'Cadência'],
    ['shield', 'Escudo'],
    ['shieldRegen', 'Regen. escudo'],
    ['hull', 'Casco'],
    ['sensorRange', 'Sensores'],
    ['cargo', 'Carga'],
  ];
  const rows: Array<{ label: string; value: string; good: boolean }> = [];
  for (const [key, label] of named) {
    const v = m[key];
    if (typeof v !== 'number' || v === 1) continue;
    rows.push({ label, value: pctLabel(v), good: v > 1 });
  }
  if (m.stealthBonus) {
    rows.push({
      label: 'Furtividade',
      value: `+${Math.round(m.stealthBonus * 100)} pts`,
      good: m.stealthBonus > 0,
    });
  }
  return rows;
}

export function createPilotCard(opts: PilotCardOptions): PilotCardHandle {
  const element = document.createElement('section');
  element.className = 'pilot-card glass';

  let profile = opts.profile;

  function render(): void {
    const cls = pilotClassById(profile.classId) ?? PILOT_CLASSES[0]!;
    const rows = modifierRows(cls);

    element.innerHTML = `
      <div class="eyebrow">Piloto</div>
      <div class="pilot-head">
        <div class="pilot-avatar">${pilotAvatarSvg(profile.callsign)}</div>
        <div class="pilot-ident">
          <input class="pilot-callsign" value="${escapeAttr(profile.callsign)}"
                 maxlength="18" aria-label="Callsign do piloto" />
          <div class="pilot-role">${escapeHtml(cls.name)} · ${escapeHtml(cls.role)}</div>
          <div class="pilot-level">Nível ${profile.level}</div>
        </div>
      </div>
      <p class="pilot-motto">"${escapeHtml(cls.motto)}"</p>
      <div class="eyebrow">Especialização</div>
      <div class="pilot-classes" role="radiogroup" aria-label="Classe do piloto">
        ${PILOT_CLASSES.map(
          (c) => `
          <button class="pilot-class-chip ${c.id === profile.classId ? 'active' : ''}"
                  data-class="${c.id}" role="radio"
                  aria-checked="${c.id === profile.classId}"
                  style="--chip: #${c.accent.toString(16).padStart(6, '0')}">
            ${escapeHtml(c.name)}
          </button>`,
        ).join('')}
      </div>
      <div class="pilot-mods">
        ${rows
          .map(
            (r) => `<div class="pilot-mod"><span>${escapeHtml(r.label)}</span>
                    <b class="${r.good ? 'up' : 'down'}">${escapeHtml(r.value)}</b></div>`,
          )
          .join('')}
      </div>
      <p class="pilot-tradeoff">${escapeHtml(cls.tradeoff)}</p>
    `;

    element.querySelectorAll<HTMLButtonElement>('.pilot-class-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const id = chip.dataset.class as PilotClassId | undefined;
        if (!id || id === profile.classId) return;
        profile = { ...profile, classId: id };
        savePilotProfile(profile);
        render();
        opts.onClassChange?.(id);
      });
    });

    const input = element.querySelector<HTMLInputElement>('.pilot-callsign');
    input?.addEventListener('change', () => {
      const next = input.value.trim() || profile.callsign;
      profile = { ...profile, callsign: next };
      savePilotProfile(profile);
      render();
      opts.onCallsignChange?.(next);
    });
  }

  render();

  return {
    element,
    update(next: PilotProfile): void {
      profile = next;
      render();
    },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
