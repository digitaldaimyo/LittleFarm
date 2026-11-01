import type { StageSpec } from './types';
import { isNode, node } from './spec';

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
    case 'add-tick-penalty':
      stage.rules.push(node('rule', { label: 'Hurry up', when: node('ev.tick'), then: [node('eff.penalty', { amount: 0.05 })] }));
      break;
    default:
      return false;
  }
  stage.version++;
  return true;
}
