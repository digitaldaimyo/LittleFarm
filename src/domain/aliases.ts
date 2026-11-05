/**
 * Old names (polish phase 3). Internal names now match what players see: Harvest, Haul, Basket run and
 * Responsibility. Cards in saves, skill cards and lesson cards made before the rename still load: their card ids
 * are renamed when they come in.
 */
export const CARD_ALIASES: Readonly<Record<string, string>> = {
  'job.forage': 'job.harvest',
  'job.deliver': 'job.haul',
  'job.tote': 'job.basketRun',
  'plan.row': 'plan.responsibility',
};

/** Old farm job ids (assignments, the job under way, evidence and learned values) → today's. */
export const JOB_ALIASES: Readonly<Record<string, string>> = { forage: 'harvest', deliver: 'haul', tote: 'basketRun' };
export const renameJob = (j: string): string => JOB_ALIASES[j] ?? j;

/** Rename old card ids everywhere inside `x` (in place). Returns how many cards it renamed. */
export function renameOldCards(x: unknown): number {
  let n = 0;
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { for (const e of v) walk(e); return; }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (typeof o.cardId === 'string' && CARD_ALIASES[o.cardId]) { o.cardId = CARD_ALIASES[o.cardId]; n++; }
    for (const k in o) walk(o[k]);
  };
  walk(x);
  return n;
}
