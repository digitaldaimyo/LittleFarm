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
    case 'shed':
      return (
        <g>
          <path d="M5 18 L20 6 L35 18 Z" fill="#A4452F" stroke="#7A2F1F" strokeWidth="1.5" strokeLinejoin="round" />
          <rect x="8" y="18" width="24" height="18" fill="#C9874E" stroke="#7F5427" strokeWidth="1.5" />
          <rect x="16" y="24" width="8" height="12" fill="#7F5427" />
          <path d="M16 24 l8 12 M24 24 l-8 12" stroke="#5E3D1C" strokeWidth="1" />
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
    case 'patch': // planted: furrows with sprouts
      return (
        <g>
          <rect x="3" y="8" width="34" height="26" rx="6" fill="#8F7A55" />
          <path d="M7 15 h26 M7 21 h26 M7 27 h26" stroke="#6F5C3C" strokeWidth="2" />
          <path d="M12 14 q-2 -4 -4 -4 M12 14 q2 -4 4 -4 M28 20 q-2 -4 -4 -4 M28 20 q2 -4 4 -4 M18 26 q-2 -4 -4 -4 M18 26 q2 -4 4 -4" stroke="#5FA35A" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        </g>
      );
    case 'soil': // empty, waiting for seeds
      return (
        <g>
          <rect x="3" y="8" width="34" height="26" rx="6" fill="#9C8762" stroke="#7A6544" strokeWidth="1.2" strokeDasharray="3 2" />
          <path d="M7 15 h26 M7 21 h26 M7 27 h26" stroke="#7A6544" strokeWidth="1.6" strokeDasharray="2 3" />
        </g>
      );
    case 'pumpkin':
      return (
        <g>
          <path d="M20 12 q1 -5 4 -6" stroke="#4E7A3A" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <ellipse cx="13" cy="24" rx="8" ry="10" fill="#E07B24" />
          <ellipse cx="27" cy="24" rx="8" ry="10" fill="#E07B24" />
          <ellipse cx="20" cy="24" rx="7" ry="11" fill="#F0913A" />
          <path d="M20 14 v20 M13 15 q-3 9 0 18 M27 15 q3 9 0 18" stroke="#C0631A" strokeWidth="1" fill="none" />
        </g>
      );
    case 'sunflower':
      return (
        <g>
          <path d="M20 22 V38" stroke="#4E9A5B" strokeWidth="2.4" />
          <path d="M20 32 q-6 -2 -8 -6 q6 0 8 4" fill="#5FA35A" />
          <g fill="#F4C430">
            {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <ellipse key={a} cx="20" cy="7" rx="3.2" ry="6" transform={`rotate(${a} 20 15)`} />)}
          </g>
          <circle cx="20" cy="15" r="5.5" fill="#7A4A1E" />
          <circle cx="18.5" cy="13.5" r="1" fill="#A06A34" />
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
    case 'chicken':
      return (
        <g>
          <ellipse cx="20" cy="35" rx="9" ry="2" fill="rgba(0,0,0,0.15)" />
          <path d="M16 33 v3 M23 33 v3" stroke="#D98E04" strokeWidth="1.6" />
          <ellipse cx="20" cy="25" rx="11" ry="9" fill="#FFFDF5" stroke="#D6CFBE" />
          <path d="M9 22 q-5 -2 -3 -7 q4 3 5 6" fill="#FFFDF5" stroke="#D6CFBE" />
          <circle cx="27" cy="15" r="6" fill="#FFFDF5" stroke="#D6CFBE" />
          <path d="M25 9 q2 -4 4 0 q2 -3 3 1" fill="#E04848" />
          <path d="M32 15 l4 1.5 -4 1.5 z" fill="#F2A71B" />
          <circle cx="28.5" cy="14" r="1.2" fill="#2B2B2B" />
          <path d="M14 25 q5 4 10 0" stroke="#E6DFCC" strokeWidth="2" fill="none" />
        </g>
      );
    case 'crow':
      return (
        <g>
          <path d="M4 18 q8 -10 16 2 q8 -12 16 -2 q-8 2 -12 8 h-8 q-4 -6 -12 -8z" fill="#2E2F38" />
          <ellipse cx="20" cy="24" rx="6" ry="7" fill="#3A3B46" />
          <circle cx="20" cy="17" r="4.5" fill="#3A3B46" />
          <path d="M20 18 l5 2 -5 1z" fill="#E0A62B" />
          <circle cx="21.5" cy="16" r="1" fill="#fff" />
        </g>
      );
    case 'egg':
      return (
        <g>
          <ellipse cx="20" cy="34" rx="7" ry="2" fill="rgba(0,0,0,0.12)" />
          <path d="M20 9 C27 9 30 22 30 26 C30 32 25 35 20 35 C15 35 10 32 10 26 C10 22 13 9 20 9Z" fill="#F7EBD8" stroke="#D9C7A8" />
          <ellipse cx="16" cy="19" rx="2.5" ry="4" fill="#fff" opacity="0.7" />
        </g>
      );
    case 'scarecrow':
      return (
        <g>
          <path d="M20 14 v22" stroke="#7F5427" strokeWidth="3" />
          <path d="M6 19 h28" stroke="#7F5427" strokeWidth="3" />
          <path d="M12 18 h16 l-2 10 h-12z" fill="#5B8BC4" />
          <circle cx="20" cy="11" r="6" fill="#E8C68E" />
          <path d="M12 7 h16 l-3 -5 h-10z" fill="#9A6A3A" />
          <path d="M17 11 h2 M21 11 h2 M18 14 q2 1.5 4 0" stroke="#3B2A1A" strokeWidth="1.2" />
          <path d="M6 19 l-2 3 M34 19 l2 3" stroke="#E2C15C" strokeWidth="2" />
        </g>
      );
    case 'gate':
      return (
        <g stroke="#7F5427" strokeWidth="1.4">
          <rect x="4" y="8" width="5" height="28" rx="1.5" fill="#B08E5C" />
          <rect x="31" y="8" width="5" height="28" rx="1.5" fill="#B08E5C" />
          <rect x="9" y="12" width="22" height="5" fill="#D9B07A" />
          <rect x="9" y="26" width="22" height="5" fill="#D9B07A" />
          <path d="M10 30 L30 13" stroke="#B08E5C" strokeWidth="3" />
        </g>
      );
    case 'gate-open':
      return (
        <g stroke="#7F5427" strokeWidth="1.4">
          <rect x="4" y="8" width="5" height="28" rx="1.5" fill="#B08E5C" />
          <rect x="31" y="8" width="5" height="28" rx="1.5" fill="#B08E5C" />
          <path d="M9 12 l8 4 v14 l-8 -4z" fill="#D9B07A" />
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

/** Homestead decorations (Academy phase 2), in the same 40×40 space as object glyphs. */
export function DecorGlyph({ item }: { item: string }) {
  switch (item) {
    case 'flowers':
      return (
        <g>
          <rect x="6" y="26" width="28" height="8" rx="4" fill="#8F7A55" />
          {[10, 17, 24, 31].map((x, i) => (
            <g key={x}>
              <path d={`M${x} 27 v-8`} stroke="#4E9A5B" strokeWidth="2" />
              <circle cx={x} cy={18} r="4" fill={['#E06C8B', '#F0B44C', '#9C6ADE', '#EE8E4A'][i]} />
              <circle cx={x} cy={18} r="1.5" fill="#FFF3C4" />
            </g>
          ))}
        </g>
      );
    case 'lantern':
      return (
        <g>
          <path d="M20 4 v6" stroke="#5B4A3A" strokeWidth="2" />
          <rect x="13" y="10" width="14" height="18" rx="4" fill="#F7D774" stroke="#5B4A3A" strokeWidth="2" />
          <circle cx="20" cy="19" r="4" fill="#FFF6D0" />
          <rect x="15" y="28" width="10" height="4" rx="1" fill="#5B4A3A" />
          <path d="M20 32 v4" stroke="#5B4A3A" strokeWidth="2" />
        </g>
      );
    case 'bench':
      return (
        <g>
          <rect x="5" y="14" width="30" height="5" rx="2" fill="#A0703F" />
          <rect x="5" y="21" width="30" height="5" rx="2" fill="#B9844D" />
          <rect x="8" y="26" width="3" height="9" fill="#6B4A2B" />
          <rect x="29" y="26" width="3" height="9" fill="#6B4A2B" />
        </g>
      );
    case 'birdhouse':
      return (
        <g>
          <path d="M20 22 v14" stroke="#6B4A2B" strokeWidth="3" />
          <path d="M9 14 L20 5 L31 14 Z" fill="#C2554A" />
          <rect x="12" y="14" width="16" height="12" rx="2" fill="#E8C98E" />
          <circle cx="20" cy="20" r="3" fill="#5B4A3A" />
        </g>
      );
    case 'bunting':
      return (
        <g>
          <path d="M3 8 q17 8 34 0" stroke="#5B4A3A" strokeWidth="1.5" fill="none" />
          {[7, 14, 21, 28, 34].map((x, i) => <path key={x} d={`M${x - 3} ${9 + (i === 2 ? 3 : i % 2 ? 2 : 1)} l3 9 l3 -9 z`} fill={['#E06C8B', '#F0B44C', '#4E9A5B', '#5B8DD6', '#9C6ADE'][i]} />)}
          <path d="M3 8 v28 M37 8 v28" stroke="#6B4A2B" strokeWidth="2" />
        </g>
      );
    case 'ribbons':
      return (
        <g>
          <rect x="6" y="5" width="28" height="22" rx="3" fill="#8F6A45" />
          <rect x="8" y="7" width="24" height="18" rx="2" fill="#E9DCC4" />
          {[13, 20, 27].map((x, i) => (
            <g key={x}>
              <circle cx={x} cy="13" r="3.5" fill={['#5B8DD6', '#C2554A', '#F0B44C'][i]} />
              <path d={`M${x - 2} 16 l-1 6 l3 -2 l3 2 l-1 -6`} fill={['#5B8DD6', '#C2554A', '#F0B44C'][i]} />
            </g>
          ))}
          <path d="M11 27 v8 M29 27 v8" stroke="#6B4A2B" strokeWidth="2.5" />
        </g>
      );
    default:
      return <circle cx="20" cy="20" r="8" fill="#ccc" />;
  }
}
