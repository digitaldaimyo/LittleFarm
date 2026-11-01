/**
 * Measured lesson checks: a few dozen quick random tries (no learning) that catch lessons whose parts
 * disagree — a rule that ends the try while SUCCESS is false every time, or a SUCCESS that is already
 * true when tries start. Runs in milliseconds; results are evidence, not guesses.
 */
import type { Diagnostic, StageSpec } from '../domain/types';
import { isNode, paramOf } from '../domain/spec';
import { compileStage } from '../sim/compile';
import { legalActions, step } from '../sim/world';
import { Rng } from '../sim/rng';

const TRIES = 30;

export function rolloutChecks(stage: StageSpec): Diagnostic[] {
  let cs;
  try { cs = compileStage(stage); } catch { return []; }
  const rng = new Rng(4242);
  const judging = new Map<string, { ended: number; judgedSuccess: number }>();
  for (const r of cs.rules) if (r.end === 'judge') judging.set(r.id, { ended: 0, judgedSuccess: 0 });
  const fired = new Map<string, number>();
  let startTrue = 0, endedBySuccess = 0;
  for (let i = 0; i < TRIES; i++) {
    const w = cs.generate(700001 + i * 13);
    if (cs.isSuccess(w)) startTrue++;
    const rs = cs.newRuleState();
    while (w.tick < stage.maxTicks) {
      const acts = legalActions(w, stage.abilities);
      const prev = { x: w.pet.x, y: w.pet.y };
      const events = step(w, acts[rng.int(acts.length)]);
      const out = cs.evalStep(w, prev, events, rs);
      for (const h of out.hits) fired.set(h.ruleId, (fired.get(h.ruleId) ?? 0) + 1);
      if (!out.end) continue;
      const ender = out.hits.find((h) => h.end)?.ruleId;
      if (!ender && cs.isSuccess(w)) endedBySuccess++;
      const j = ender ? judging.get(ender) : undefined;
      if (j) { j.ended++; if (cs.isSuccess(w)) j.judgedSuccess++; }
      break;
    }
  }
  const out: Diagnostic[] = [];
  for (const [ruleId, j] of judging) {
    if (j.ended < 3 || j.judgedSuccess > 0) continue;
    const rule = stage.rules.find((r) => r.id === ruleId)!;
    const label = paramOf(rule, 'label', 'A rule');
    const ev = isNode(rule.args.when) ? rule.args.when : null;
    const useHas = !!ev && ev.cardId !== 'ev.tick';
    out.push({
      severity: 'warning', code: 'end-never-success', nodeId: ruleId,
      message: `“${label}” ends the try, but in ${j.ended} quick random tries SUCCESS was false every time it did — so each of those counts as a miss. `
        + (useHas ? 'If this event *is* the goal, make SUCCESS remember it (or set the rule’s End try to “counts as a success”).' : 'Set its End try to “counts as a success” if reaching it is the goal, or check SUCCESS.'),
      repair: useHas ? { label: 'SUCCESS: “Has done…” this', action: 'success-has-event', ruleId } : { label: 'End try counts as a success', action: 'end-counts-success', ruleId },
    });
  }
  // A goal rule (it ends the try) that never gets a chance: SUCCESS keeps ending tries before it fires.
  if (endedBySuccess >= TRIES / 3) {
    for (const r of stage.rules) {
      const ends = (Array.isArray(r.args.then) ? r.args.then : []).some((e) => isNode(e) && e.cardId === 'eff.end' && e.args.outcome !== 'fail');
      const ev = isNode(r.args.when) ? r.args.when : null;
      if (!ends || !ev || ev.cardId === 'ev.tick' || (fired.get(r.id) ?? 0) > 0) continue;
      const label = paramOf(r, 'label', 'A rule');
      out.push({
        severity: 'warning', code: 'goal-rule-shadowed', nodeId: r.id,
        message: `SUCCESS ended ${endedBySuccess} of ${TRIES} quick random tries before “${label}” ever fired — so the pet can succeed without doing what “${label}” is about. If that event is the goal, put it in SUCCESS.`,
        repair: { label: 'SUCCESS: “Has done…” this', action: 'success-has-event', ruleId: r.id },
      });
    }
  }
  if (stage.success && stage.outcome !== 'survive' && startTrue >= TRIES / 5) {
    out.push({ severity: 'warning', code: 'success-at-start', message: `SUCCESS is already true when many tries start (${startTrue} of ${TRIES} layouts), so the pet gets credit without doing anything. Check what SUCCESS asks for.` });
  }
  return out;
}
