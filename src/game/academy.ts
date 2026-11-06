/**
 * Willowbrook Academy (Academy roadmap, phase 0): the school's framing and each pet's record. Challenges arrive in
 * phase 1; here are the courses, ranks and certificates they will fill in, and the one currency (acorns).
 */
import type { GameState, Pet } from './types';

export const SCHOOL = {
  name: 'Willowbrook Academy',
  mentor: 'Professor Hazel',
  /** What the mentor is, for art and alt text. */
  mentorIs: 'an old, unhurried tortoise',
  currency: { one: 'acorn', many: 'acorns' },
} as const;

/** Ranks a pet rises through, one per course exam passed. */
export const RANKS = ['Novice', 'Apprentice', 'Journeypet', 'Adept', 'Master'] as const;
export type Rank = (typeof RANKS)[number];

export interface Course {
  id: string;
  title: string;
  about: string;
  /** Hazel's word as the course opens. */
  hazel: string;
  exam: string;
  /** The rank its exam earns (the last course earns an honour, not a rank). */
  earns: Rank | null;
}

export const COURSES: Course[] = [
  { id: 'first-steps', title: 'First Steps', about: 'Going places, treats and SUCCESS.', hazel: 'Your pet will only learn what you reward. Shall we see what you’re rewarding?', exam: 'The Apprentice exam', earns: 'Apprentice' },
  { id: 'fetch-carry', title: 'Fetch and Carry', about: 'Carrying things where they belong.', hazel: 'Picking something up is easy. Putting it in the right place is the lesson.', exam: 'The Journeypet exam', earns: 'Journeypet' },
  { id: 'thinking-ahead', title: 'Thinking Ahead', about: 'Senses, notes and measures.', hazel: 'A pet can only decide on what it can sense. Choose carefully, and choose few.', exam: 'The Adept exam', earns: 'Adept' },
  { id: 'working-together', title: 'Working Together', about: 'Routines that combine skills.', hazel: 'Many small skills, chosen well, make a big one. That is all a routine is.', exam: 'The Master exam', earns: 'Master' },
  { id: 'days-work', title: 'A Day’s Work', about: 'Responsibilities, several pets, a whole day.', hazel: 'Now let them run a whole day. You set the priorities; they do the work.', exam: 'The Willowbrook Honour', earns: null },
];

/** A passed challenge: a rosette, with a merit badge for each mastery star earned. */
export interface Certificate { challengeId: string; at: number; badges: string[] }

export interface AcademyState {
  /** The one currency: earned from certificates and merit badges, spent in the Homestead. */
  acorns: number;
  /** Per pet: certificates by challenge id, and the courses whose exam it passed. */
  pets: Record<string, { certificates: Record<string, Certificate>; exams: string[] }>;
  /** Courses whose opening word from Hazel the player has read. */
  greeted: string[];
  /** Homestead decorations bought with acorns (drawn over the farm, never in the way). */
  decor?: { id: number; item: string; x: number; y: number }[];
  /** Playtest measures, recorded only while the player has them on (game/measures.ts). */
  measures?: import('./measures').Measures;
}

export function newAcademyState(): AcademyState {
  return { acorns: 0, pets: {}, greeted: [] };
}

/** The academy edition (Academy roadmap). Farm-edition games (legacy, kept for tests until phase 6) have no record. */
export const isAcademy = (s: GameState): boolean => !!s.academy;

/** A pet's record, read-only (an empty one if it has none yet). */
export function petRecordOf(s: GameState, petId: string): AcademyState['pets'][string] {
  return s.academy?.pets[petId] ?? { certificates: {}, exams: [] };
}

/** A pet's record, created if missing (for writing). */
export function petRecord(s: GameState, petId: string): AcademyState['pets'][string] {
  const a = s.academy!;
  return (a.pets[petId] ??= { certificates: {}, exams: [] });
}

/** A pet's rank: Novice, then one rank per course exam passed. */
export function petRank(s: GameState, pet: Pet): Rank {
  if (!s.academy) return 'Novice';
  const passed = (s.academy.pets[pet.id]?.exams ?? []).map((id) => COURSES.find((c) => c.id === id)?.earns).filter(Boolean) as Rank[];
  return passed.reduce<Rank>((best, r) => (RANKS.indexOf(r) > RANKS.indexOf(best) ? r : best), 'Novice');
}

export const acornText = (n: number) => `${n} ${n === 1 ? SCHOOL.currency.one : SCHOOL.currency.many}`;
