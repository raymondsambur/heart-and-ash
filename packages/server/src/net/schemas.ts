/**
 * Runtime validation of every client -> server message (zod). Nothing reaches the game layer
 * unless it parses here; unknown fields are stripped, numbers are bounded.
 *
 * The compile-time check at the bottom guarantees the schema output is assignable to `C2S`,
 * so adding a message to protocol.ts without a schema (or with a wrong one) fails type checking.
 */
import { BUILD_KINDS, JOB_GROUPS, RULE_METRICS, type C2S } from '@hearth/shared';
import { z } from 'zod';

/** Largest accepted text message in bytes (checked by the gateway before parsing). */
export const MAX_MESSAGE_BYTES = 4096;

const int = (min: number, max: number) => z.number().int().min(min).max(max);

/** The time controls: 0 pauses. */
const speed = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(4)]);

const ruleSchema = z.object({
  id: int(0, 2 ** 31 - 1),
  enabled: z.boolean(),
  cond: z.object({ metric: z.enum(RULE_METRICS), op: z.enum(['<', '>', '=']), value: z.number().finite().min(-100000).max(100000) }),
  act: z.discriminatedUnion('t', [
    z.object({ t: z.literal('ration'), level: z.union([z.literal(0), z.literal(1), z.literal(2)]) }),
    z.object({ t: z.literal('priority'), group: z.enum(JOB_GROUPS), level: int(0, 4) }),
    z.object({ t: z.literal('build'), kind: z.enum(BUILD_KINDS) }),
  ]),
});

export const c2sSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('hello'), v: int(0, 1000) }),
  z.object({ t: z.literal('speed'), speed }),
  z.object({ t: z.literal('inspect'), id: int(0, 2 ** 31 - 1).nullable() }),
  z.object({ t: z.literal('build'), kind: z.enum(BUILD_KINDS), x: int(0, 255), y: int(0, 255), rot: z.boolean().optional() }),
  z.object({ t: z.literal('demolish'), building: int(0, 2 ** 31 - 1).optional(), plot: int(0, 2 ** 31 - 1).optional() }),
  z.object({ t: z.literal('cancel'), order: int(0, 2 ** 31 - 1) }),
  z.object({ t: z.literal('priority'), group: z.enum(JOB_GROUPS), level: int(0, 4) }),
  z.object({ t: z.literal('rule'), rule: ruleSchema }),
  z.object({ t: z.literal('rule_del'), id: int(0, 2 ** 31 - 1) }),
  z.object({ t: z.literal('answer'), offer: int(0, 2 ** 31 - 1), option: z.string().min(1).max(32) }),
  z.object({ t: z.literal('read'), report: int(0, 2 ** 31 - 1) }),
  z.object({ t: z.literal('ration'), level: z.union([z.literal(0), z.literal(1), z.literal(2)]) }),
  z.object({ t: z.literal('ping'), n: int(0, 2 ** 31 - 1) }),
]);

// Compile-time guard: every parsed message is a valid C2S, and every C2S type has a schema.
type Parsed = z.infer<typeof c2sSchema>;
type AssertAssignable<A extends B, B> = A;
export type _ParsedIsC2S = AssertAssignable<Parsed, C2S>;
export type _C2SIsParsed = AssertAssignable<C2S, Parsed>;

export type ParseResult = { ok: true; msg: C2S } | { ok: false; error: string };

export function parseClientMessage(raw: string): ParseResult {
  if (raw.length > MAX_MESSAGE_BYTES) return { ok: false, error: 'message too large' };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'not valid JSON' };
  }
  const r = c2sSchema.safeParse(json);
  if (!r.success) {
    const issue = r.error.issues[0];
    const where = issue && issue.path.length ? ` (${issue.path.join('.')})` : '';
    return { ok: false, error: `${issue?.message ?? 'invalid'}${where}`.slice(0, 120) };
  }
  return { ok: true, msg: r.data };
}
