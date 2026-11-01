import type { LearnerTemplate, SkillName, SpecNode, StageSpec, Template } from '../domain/types';
import type { SenseSkillDef } from '../learning/policies';
import type { SerializedQ } from '../learning/qtable';
import type { Traits } from '../learning/episodes';
import type { ExecutiveTable, Invocation } from '../learning/executive';
import type { World } from '../sim/world';

export const SAVE_VERSION = 3;

export type PaletteId = 'meadow' | 'plum' | 'sky' | 'moss';
export type JobId = 'forage' | 'deliver' | 'rest' | 'skill';
export type NavigatorName = 'Approach' | 'Avoid';

export interface SkillEval {
  successRate: number;
  episodes: number;
  meanReward: number;
  beforeRate: number;
  randomRate: number;
  transferRate: number;
  passed: boolean;
  minimum: number;
}

export interface SkillRevision {
  rev: number;
  createdAt: number;
  stageId: string;
  stageName: string;
  stageVersion: number;
  episodes: number;
  policy: SerializedQ;
  eval: SkillEval;
  provenance: {
    trainer: string;
    features: string;
    trainSeeds: string;
    evalSeeds: number[];
    navigator?: { skill: NavigatorName; rev: number };
    durationMs: number;
    simTicks: number;
    resumedFrom?: number;
  };
  note?: string;
  /** Sense skills: the senses/actions this policy was trained with (absent = Approach/Avoid preset). */
  learner?: SenseSkillDef;
  /** Kind the skill was aimed at during training. */
  focus?: string;
  /** The lesson's SUCCESS condition and outcome mode — the skill's own termination when run on the farm. */
  success?: SpecNode | null;
  outcome?: 'reach' | 'survive';
  maxTicks?: number;
}

export interface Skill {
  id: string;
  name: SkillName;
  kind: 'nav' | 'fetch';
  /** 'sense' for movement/custom skills, 'fetch' for the Fetch controller. Absent in v1 saves. */
  template?: LearnerTemplate;
  /** Player-made (not one of the built-in presets). */
  custom?: boolean;
  signature: string;
  initiation: string;
  termination: string;
  nickname?: string;
  activeRev: number;
  revisions: SkillRevision[];
  /** Composite skills: which navigation skill they invoke for movement. */
  navigator?: NavigatorName;
}

export interface StageMastery {
  rate: number;
  episodes: number;
  rev: number;
  skill: SkillName;
  at: number;
  /** Re-evaluations after later training (retention). */
  retention?: { rate: number; at: number };
  transfer?: number;
}

export interface Assignment {
  mode: 'auto' | 'job' | 'manual';
  job: JobId;
  navigator: NavigatorName;
  /** For the "Run a skill" job: which skill, aimed at what. */
  skillName?: string;
  target?: string;
}

export interface PetStats {
  coins: number;
  berries: number;
  carrots: number;
  dips: number;
  trainingRuns: number;
  episodes: number;
  deliveries: number;
  fireflies?: number;
  waterings?: number;
}

export interface Pet {
  id: string;
  name: string;
  palette: PaletteId;
  createdAt: number;
  traits: Traits;
  energy: number;
  mood: number;
  skills: Skill[];
  executive: { mode: 'rules' | 'learned'; table: ExecutiveTable; decisions: number };
  feedback: Record<string, Record<string, number>>;
  stats: PetStats;
  assignment: Assignment;
  mastery: Record<string, StageMastery>;
  nicknames?: Record<string, string>;
}

export interface Plot {
  x: number;
  y: number;
  crop: 'berry' | 'carrot';
  objId: number | null;
  timer: number;
  unlock?: string;
}

export interface FarmState {
  world: World;
  plots: Plot[];
  tick: number;
  rngState: number;
  dutyPetId: string | null;
  stun: number;
  queue: Invocation[];
  current: Invocation | null;
  production: { tick: number; coins: number }[];
  manualMode: boolean;
}

export interface JournalEntry {
  id: string;
  at: number;
  petId: string | null;
  kind: string;
  text: string;
  /** Scrapbook-worthy milestone. */
  milestone?: boolean;
}

export interface Settings {
  reducedMotion: 'system' | 'on' | 'off';
  sound: boolean;
  farmSpeed: number;
  trainSpeed: 'watch' | 'normal' | 'fast';
  showExpert: boolean;
}

export interface Progress {
  tutorialStep: number;
  tutorialDone: boolean;
  unlocks: string[];
  totalCoins: number;
  flags: Record<string, boolean>;
}

export interface GameState {
  version: number;
  createdAt: number;
  updatedAt: number;
  settings: Settings;
  progress: Progress;
  resources: { coins: number; berries: number; carrots: number; fireflies?: number };
  pets: Pet[];
  activePetId: string | null;
  farm: FarmState;
  stages: StageSpec[];
  activeStageId: string | null;
  stageHistory: Record<string, StageSpec[]>;
  templates: Template[];
  journal: JournalEntry[];
  recentCards: string[];
  favorites: string[];
  purchases: string[];
  extensions?: Record<string, unknown>;
}
