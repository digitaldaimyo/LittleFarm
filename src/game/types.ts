import type { AudioSettings } from './sound';
import type { LearnerTemplate, SkillName, SpecNode, StageSpec, Template } from '../domain/types';
import type { SenseSkillDef } from '../learning/policies';
import type { FarmRequest } from './requests';
import type { BehaviorSummary } from '../learning/summary';
import type { GuideRun, GuideState } from './tutorial';
import type { SerializedQ } from '../learning/qtable';
import type { Traits } from '../learning/episodes';
import type { ExecutiveTable, Invocation } from '../learning/executive';
import type { ExecValues } from './plan';
import type { World } from '../sim/world';

export const SAVE_VERSION = 10;

export type PaletteId = 'meadow' | 'plum' | 'sky' | 'moss';
export type JobId = 'forage' | 'deliver' | 'plant' | 'tote' | 'rest' | 'skill';
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
  /** Big brains: an older revision's table was not kept (to keep saves small); its report remains. */
  tableDropped?: boolean;
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
  /** Routines: the skill revisions it was trained and certified with… */
  uses?: { skill: string; rev: number }[];
  /** …and a copy of its lesson (options, watched conditions, size), needed to run it anywhere. */
  stage?: StageSpec;
  /** What it actually did on the held-out layouts (heatmap, action mix, endings…). */
  summary?: BehaviorSummary;
}

export interface Skill {
  id: string;
  name: SkillName;
  kind: 'nav' | 'fetch' | 'routine';
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
  /** Run this revision instead of the active one (the player pinned it). */
  pinnedRev?: number;
  /** On the farm: 'on' = usable even if uncertified, 'off' = never on its own; absent = certified only. */
  farmUse?: 'on' | 'off';
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

export interface FarmPlan {
  rows: SpecNode[];
  /** 'first': the first applicable row wins. 'learned': a small bandit picks among applicable rows. */
  chooser: 'first' | 'learned';
  /** Anti-dithering guard (on by default). */
  guard: boolean;
  table?: ExecutiveTable;
}

export interface Assignment {
  mode: 'auto' | 'job' | 'manual' | 'plan';
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
  planted?: number;
  crowsShooed?: number;
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
  /**
   * How Auto picks among responsibilities: the player's order ('rules'), or learned values ('learned', phase 5).
   * `table` is the retired bandit's (kept so old saves load); `values` are the learned executive's.
   */
  executive: { mode: 'rules' | 'learned'; table: ExecutiveTable; decisions: number; values?: ExecValues; /** Learned picks keep trying things on the farm (unset: on until the pet has practised). */ explore?: boolean };
  /** Which learned skill or routine does each farm job (learned-farm phase 3); absent = the job's own recipe/name. */
  jobSkills?: Partial<Record<string, string>>;
  feedback: Record<string, Record<string, number>>;
  stats: PetStats;
  assignment: Assignment;
  mastery: Record<string, StageMastery>;
  /** Responsibilities (phase 4; the farm plan's rows grew into them). Auto starts from the starter ones. */
  plan?: FarmPlan;
  /** Evidence from the farm, per job (`forage`, `skill:Patrol`…): uses, successes, ticks. Used to pick jobs. */
  evidence?: Record<string, { n: number; ok: number; ticks: number }>;
  nicknames?: Record<string, string>;
}

export interface Helper {
  petId: string;
  current: Invocation | null;
  stun: number;
  queue: Invocation[];
  rngState: number;
}

export interface Plot {
  x: number;
  y: number;
  /** Berry bushes are perennial; the rest are field crops that are replanted after each harvest. */
  crop: 'berry' | 'carrot' | 'pumpkin' | 'sunflower';
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
  /**
   * Pets on duty besides the lead (`dutyPetId`), up to 3 (farm life D). Each has its own current job, stun,
   * decisions and RNG; its body is `world.crew[i]`.
   */
  helpers?: Helper[];
  /** Neighbours' requests board. */
  requests?: FarmRequest[];
  /** Farm layouts applied so far (layout mode). */
  layoutEdits?: number;
  /** Current shower: raining until this tick; the temporary pond tiles it made. */
  rainUntil?: number;
  puddles?: number[];
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
  /** Volumes and sound options (docs/SOUND_PLAN.md). Filled from defaults when loading older saves. */
  audio: AudioSettings;
  farmSpeed: number;
  trainSpeed: 'watch' | 'normal' | 'fast';
  showExpert: boolean;
}

export interface Progress {
  tutorialStep: number;
  tutorialDone: boolean;
  /** Field Guide lessons (created lazily; older saves map their tutorial onto Chapter 1). */
  guide?: GuideState;
  /** Results of training runs in Field Guide pens, for side-by-side comparisons. */
  guideRuns?: Record<string, GuideRun[]>;
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
  resources: { coins: number; berries: number; carrots: number; fireflies?: number; eggs?: number };
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
