/** Memories: bounded, decaying, and the raw material of opinions, grudges and gossip (docs/notes/m1-agent-brain-spec.md, section 7). */
import type { Memory, Person } from './types';

export const MAX_MEMORIES = 40;
/** Days for a memory's weight to halve. */
export const HALF_LIFE_DAYS = 20;

export function remember(p: Person, m: Omit<Memory, 'w'> & { w?: number }): void {
  // The same thing about the same person reinforces the old memory instead of adding another.
  const same = p.memory.find((x) => x.kind === m.kind && x.who === m.who && x.from === m.from);
  if (same) {
    same.w = Math.min(1.5, same.w + 0.5);
    same.day = m.day;
    same.val = (same.val + m.val) / 2;
    return;
  }
  p.memory.push({ ...m, w: m.w ?? 1 });
  if (p.memory.length > MAX_MEMORIES) {
    // Forget the least salient one.
    let worst = 0;
    for (let i = 1; i < p.memory.length; i++) if (p.memory[i].w * (0.3 + Math.abs(p.memory[i].val)) < p.memory[worst].w * (0.3 + Math.abs(p.memory[worst].val))) worst = i;
    p.memory.splice(worst, 1);
  }
}

/** Once a game day: every weight halves every `HALF_LIFE_DAYS`, and faded memories are dropped. */
export function decayMemories(p: Person): void {
  const f = Math.pow(0.5, 1 / HALF_LIFE_DAYS);
  for (const m of p.memory) m.w *= f;
  p.memory = p.memory.filter((m) => m.w > 0.08);
}

/** The strongest grudge: a negative memory about a living person. */
export function worstGrudge(p: Person): Memory | null {
  let best: Memory | null = null;
  for (const m of p.memory) if (m.who !== undefined && m.val < -0.3 && (!best || m.w * -m.val > best.w * -best.val)) best = m;
  return best;
}
