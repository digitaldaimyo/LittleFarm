/**
 * Canonical typed specification for Pen Deck.
 * The UI edits these shapes; the simulator and learners compile from validated specs.
 */
export type TypeExpr =
  | { kind: 'nominal'; name: string }
  | { kind: 'generic'; name: string; args: TypeExpr[] };

export interface SocketDef {
  id: string;
  label: string;
  type: TypeExpr;
  required: boolean;
  many?: boolean;
}

export interface ParamDef {
  id: string;
  label: string;
  kind: 'number' | 'text' | 'choice';
  default: number | string;
  min?: number;
  max?: number;
  step?: number;
  choices?: { value: string; label: string }[];
}

export type CardGroup =
  | 'kind' | 'actor' | 'event' | 'condition' | 'effect' | 'limit' | 'quantity'
  | 'reference' | 'placement' | 'rule';

export interface CardDef {
  id: string;
  pack: string;
  version: number;
  output: TypeExpr;
  sockets: SocketDef[];
  params?: ParamDef[];
  /** Name of the runtime evaluator the compiler binds this card to. */
  evaluator: string;
  /** Event cards that bind the scoped reference `it` to the affected object. */
  bindsIt?: boolean;
  /** Unlock flag required before the card is usable. */
  unlock?: string;
  presentation: {
    title: string;
    group: CardGroup;
    sheet: string;
    hint?: string;
    /** Sentence template; {socketId} and {paramId} are substituted. */
    phrase?: string;
    icon?: string;
  };
}

export type ArgValue = SpecNode | SpecNode[] | number | string | undefined;

export interface SpecNode {
  id: string;
  cardId: string;
  args: Record<string, ArgValue>;
  /** Unknown/extension data — must round-trip unchanged. */
  extensions?: Record<string, unknown>;
}

export interface EvaluationSpec {
  episodes: number;
  seedSet: number[];
  minimumSuccessRate: number;
  maximumFailureRate?: number;
}

export type SkillName = 'Approach' | 'Avoid' | 'Fetch';

export interface LearnerSpec {
  /** Which reusable behavior this stage teaches. */
  skill: SkillName;
  /** Object kind the behavior is pointed at during training (e.g. berry). */
  focus: string;
  /** Destination kind for composite skills (Fetch). */
  destination?: string;
  /** Navigation skill a composite uses as its movement option. */
  navigator?: 'Approach' | 'Avoid';
  episodes: number;
}

export interface StageSpec {
  id: string;
  name: string;
  blurb?: string;
  version: number;
  size: { w: number; h: number };
  environment: SpecNode[];
  abilities: string[];
  rules: SpecNode[];
  success: SpecNode | null;
  fail?: SpecNode | null;
  seed: number;
  maxTicks: number;
  learner: LearnerSpec;
  evaluation: EvaluationSpec;
  /** Starter recipe this stage was cloned from, if any. */
  recipeId?: string;
  extensions?: Record<string, unknown>;
}

export interface ObjectDef {
  id: string;
  name: string;
  plural: string;
  traits: string[];
  solid: boolean;
  hazard: boolean;
  carryable: boolean;
  container: boolean;
  /** Only shown in pen vocab when unlocked. */
  unlock?: string;
  penPlaceable: boolean;
  hint: string;
}

export interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  nodeId?: string;
  /** Suggested repair, applied by the UI. */
  repair?: { label: string; action: string; ruleId?: string };
}

export interface Template {
  id: string;
  name: string;
  revision: number;
  createdAt: number;
  output: TypeExpr;
  root: SpecNode;
  /** Param paths the player chose to expose (nodeId.paramId). */
  exposed: string[];
}
