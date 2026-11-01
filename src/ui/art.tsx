import { PALETTES } from '../game/pets';
import type { PaletteId } from '../game/types';

export type PetMood = 'idle' | 'move' | 'carry' | 'celebrate' | 'confused' | 'nap' | 'wet';

/** Procedural pet: a round little critter. All vector, no external assets. */
export function PetSprite({ palette, mood = 'idle', size = 40, carrying }: { palette: PaletteId; mood?: PetMood; size?: number; carrying?: string | null }) {
  const p = PALETTES.find((x) => x.id === palette) ?? PALETTES[0];
  const sleeping = mood === 'nap';
  return (
    <svg className={`pet pet-${mood}`} width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <g className="pet-body">
        <ellipse cx="20" cy="36" rx="11" ry="2.4" fill="rgba(0,0,0,0.15)" />
        <path d="M30 27 q7 -2 6 -9" stroke={p.ear} strokeWidth="3" fill="none" strokeLinecap="round" className="pet-tail" />
        <path d="M9 13 L7 3 L16 9 Z" fill={p.ear} />
        <path d="M31 13 L33 3 L24 9 Z" fill={p.ear} />
        <ellipse cx="20" cy="22" rx="13" ry="12" fill={p.body} />
        <ellipse cx="20" cy="27" rx="8" ry="6.5" fill={p.belly} />
        {sleeping ? (
          <>
            <path d="M13 19 q2.5 2 5 0" stroke={p.ink} strokeWidth="1.6" fill="none" strokeLinecap="round" />
            <path d="M22 19 q2.5 2 5 0" stroke={p.ink} strokeWidth="1.6" fill="none" strokeLinecap="round" />
          </>
        ) : (
          <>
            <circle cx="15.5" cy="19" r="2.2" fill={p.ink} />
            <circle cx="24.5" cy="19" r="2.2" fill={p.ink} />
            <circle cx="16.2" cy="18.2" r="0.7" fill="#fff" />
            <circle cx="25.2" cy="18.2" r="0.7" fill="#fff" />
          </>
        )}
        <circle cx="12" cy="23" r="1.8" fill="#F29A9A" opacity="0.55" />
        <circle cx="28" cy="23" r="1.8" fill="#F29A9A" opacity="0.55" />
        {mood === 'celebrate' ? <path d="M17 23 q3 4 6 0 Z" fill={p.ink} /> : <path d="M18 23.5 q2 1.6 4 0" stroke={p.ink} strokeWidth="1.3" fill="none" strokeLinecap="round" />}
        {mood === 'wet' && <g fill="#5AA9E6"><circle cx="7" cy="16" r="1.4" /><circle cx="34" cy="22" r="1.2" /><circle cx="9" cy="28" r="1" /></g>}
        {carrying && <g transform="translate(13 25) scale(0.35)"><ObjectGlyph kind={carrying} /></g>}
      </g>
      {mood === 'confused' && <text x="31" y="9" fontSize="11" fontWeight="700" fill="#7A4800">?</text>}
      {sleeping && <text x="29" y="10" fontSize="8" fontWeight="700" fill="#24527A" className="zzz">z</text>}
      {mood === 'celebrate' && <g fill="#F0B44C"><path d="M4 6 l1 2 2 .3 -1.5 1.4 .4 2 -1.9 -1 -1.9 1 .4 -2 -1.5 -1.4 2 -.3z" /><path d="M35 4 l.8 1.6 1.7.2 -1.2 1.2 .3 1.7 -1.6 -.8 -1.6.8 .3 -1.7 -1.2 -1.2 1.7 -.2z" /></g>}
    </svg>
  );
}

/** Object glyph drawn into a 40×40 box. */
export function ObjectGlyph({ kind }: { kind: string }) {
  switch (kind) {
    case 'berry':
      return (
        <g>
          <path d="M20 9 q4 -5 9 -3 q-3 4 -9 3" fill="#4E9A5B" />
          <circle cx="15" cy="21" r="7" fill="#7B3FA0" />
          <circle cx="25" cy="21" r="7" fill="#8E4DB5" />
          <circle cx="20" cy="29" r="7" fill="#6E3592" />
          <circle cx="13" cy="19" r="1.8" fill="#fff" opacity="0.5" />
        </g>
      );
    case 'carrot':
      return (
        <g>
          <path d="M17 12 q-3 -7 -1 -9 q2 3 3 8 M21 11 q1 -7 5 -8 q0 4 -3 9" fill="#4E9A5B" stroke="#3E7F49" strokeWidth="1" />
          <path d="M13 13 Q20 9 27 13 L21 36 Q20 38 19 36 Z" fill="#EE8A2B" />
          <path d="M16 19 h4 M17 25 h3 M18 30 h2" stroke="#C86A12" strokeWidth="1.3" strokeLinecap="round" />
        </g>
      );
    case 'target':
      return (
        <g>
          <circle cx="20" cy="20" r="14" fill="#fff" stroke="#C0392B" strokeWidth="3" />
          <circle cx="20" cy="20" r="8" fill="#fff" stroke="#C0392B" strokeWidth="3" />
          <circle cx="20" cy="20" r="3" fill="#C0392B" />
        </g>
      );
    case 'bin':
      return (
        <g>
          <path d="M8 15 h24 l-3 20 h-18 z" fill="#B07D46" stroke="#7F5427" strokeWidth="1.5" />
          <path d="M10 21 h20 M11 27 h18" stroke="#7F5427" strokeWidth="1.3" />
          <path d="M12 15 q8 -10 16 0" fill="none" stroke="#7F5427" strokeWidth="2" />
        </g>
      );
    case 'pond':
      return (
        <g>
          <rect x="1" y="1" width="38" height="38" rx="9" fill="#7FBCE6" />
          <path d="M8 16 q4 -3 8 0 t8 0 M14 26 q4 -3 8 0 t8 0" stroke="#fff" strokeWidth="2" fill="none" opacity="0.8" strokeLinecap="round" />
        </g>
      );
    case 'rock':
      return (
        <g>
          <path d="M6 30 Q5 18 14 13 Q22 8 30 14 Q37 20 34 30 Z" fill="#9A9A92" />
          <path d="M12 18 q5 -4 10 -2" stroke="#C8C8C0" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M6 30 h28" stroke="#6E6E66" strokeWidth="2" />
        </g>
      );
    case 'tree':
      return (
        <g>
          <rect x="17" y="24" width="6" height="12" rx="2" fill="#7F5427" />
          <circle cx="20" cy="17" r="12" fill="#3E8E4E" />
          <circle cx="14" cy="13" r="4" fill="#58A866" />
        </g>
      );
    case 'fence':
      return (
        <g fill="#C9A06A" stroke="#8C6A3C" strokeWidth="1.2">
          <rect x="7" y="8" width="5" height="28" rx="1.5" />
          <rect x="28" y="8" width="5" height="28" rx="1.5" />
          <rect x="4" y="14" width="32" height="4" />
          <rect x="4" y="25" width="32" height="4" />
        </g>
      );
    case 'home':
      return (
        <g>
          <path d="M5 19 L20 6 L35 19 Z" fill="#C0574A" />
          <rect x="9" y="18" width="22" height="17" fill="#F3E2C3" stroke="#B08E5C" />
          <rect x="17" y="24" width="7" height="11" rx="3" fill="#8C5A33" />
        </g>
      );
    case 'bush':
      return (
        <g>
          <circle cx="13" cy="24" r="9" fill="#5F9E58" />
          <circle cx="27" cy="24" r="9" fill="#5F9E58" />
          <circle cx="20" cy="17" r="9" fill="#6CAF64" />
        </g>
      );
    case 'patch':
      return (
        <g>
          <rect x="3" y="8" width="34" height="26" rx="6" fill="#8F7A55" />
          <path d="M7 15 h26 M7 21 h26 M7 27 h26" stroke="#6F5C3C" strokeWidth="2" />
        </g>
      );
    case 'well':
      return (
        <g>
          <ellipse cx="20" cy="27" rx="13" ry="8" fill="#8C8C84" />
          <ellipse cx="20" cy="25" rx="10" ry="5.5" fill="#3E6E9E" />
          <path d="M9 12 v14 M31 12 v14" stroke="#7F5427" strokeWidth="2.5" />
          <path d="M6 13 L20 5 L34 13 Z" fill="#B0574A" />
          <path d="M20 13 v8" stroke="#5B4636" strokeWidth="1.2" />
          <rect x="17" y="19" width="6" height="4" rx="1" fill="#9A6A3A" />
        </g>
      );
    case 'firefly':
      return (
        <g className="firefly">
          <circle cx="20" cy="20" r="11" fill="#FFF3A0" opacity="0.35" />
          <circle cx="20" cy="20" r="5" fill="#FFE45C" />
          <ellipse cx="15" cy="15" rx="4" ry="2.5" fill="#fff" opacity="0.7" />
          <ellipse cx="25" cy="15" rx="4" ry="2.5" fill="#fff" opacity="0.7" />
        </g>
      );
    case 'pet':
      return <circle cx="20" cy="20" r="12" fill="#E8B878" />;
    default:
      return <circle cx="20" cy="20" r="10" fill="#ccc" />;
  }
}

export function ObjectIcon({ kind, size = 24, title }: { kind: string; size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <ObjectGlyph kind={kind} />
    </svg>
  );
}
