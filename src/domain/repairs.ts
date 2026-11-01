import type { StageSpec } from './types';
import { cloneNode, findInStage, isNode, node } from './spec';

/** Apply a suggested repair card to a stage (returns false if not applicable). */
export function applyRepair(stage: StageSpec, action: string, ruleId?: string): boolean {
  const rule = ruleId ? stage.rules.find((r) => r.id === ruleId) : undefined;
  switch (action) {
    case 'limit-per-object':
      if (!rule) return false;
      rule.args.limit = node('lim.perObject');
      break;
    case 'limit-once':
      if (!rule) return false;
      rule.args.limit = node('lim.once');
      break;
    case 'flip-tick': {
      if (!rule) return false;
      const t = rule.args.then;
      const list = Array.isArray(t) ? t : isNode(t) ? [t] : [];
      for (const e of list) if (e.cardId === 'eff.reward') e.cardId = 'eff.penalty';
      break;
    }
    case 'add-did-sense': {
      // ruleId carries the "Has …" node whose event the pet should be able to sense.
      const n = ruleId ? findInStage(stage, ruleId) : null;
      const ev = n?.args.event;
      if (!isNode(ev)) return false;
      (stage.learner.senses ??= []).push(node('sense.did', { event: cloneNode(ev, true) }));
      break;
    }
    case 'end-counts-success': {
      // Make this rule's End try count as a success outright.
      const ends = (rule ? (Array.isArray(rule.args.then) ? rule.args.then : []) : []).filter((e) => isNode(e) && e.cardId === 'eff.end');
      if (!ends.length) return false;
      for (const e of ends) if (isNode(e)) e.args.outcome = 'success';
      break;
    }
    case 'success-has-event': {
      // SUCCESS becomes "Has done… (this rule's event)".
      const ev = rule?.args.when;
      if (!isNode(ev)) return false;
      stage.success = node('cond.happened', { event: cloneNode(ev, true), count: 1 });
      break;
    }
    case 'add-tick-penalty':
      stage.rules.push(node('rule', { label: 'Hurry up', when: node('ev.tick'), then: [node('eff.penalty', { amount: 0.05 })] }));
      break;
    default:
      return false;
  }
  stage.version++;
  return true;
}
