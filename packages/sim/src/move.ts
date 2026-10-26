/** Walking: paths over the shared grid, one tile at a time, as in M0 (the view reports the step in progress and the tiles after it). */
import { STEP_MS, findPath, isPassable, tileSpeed, type Dir, type Point } from '@hearth/shared';
import type { Ctx } from './ctx';
import type { Person } from './types';

export function faceOf(dx: number, dy: number, keep: Dir): Dir {
  if (dx === 0 && dy === 0) return keep;
  const sx = dx - dy;
  const sy = dx + dy;
  if (sy >= 0) return sx >= 0 ? 0 : 1;
  return sx >= 0 ? 3 : 2;
}

export function isMoving(p: Person): boolean {
  return p.stepMs > 0;
}

function beginStep(c: Ctx, p: Person): void {
  const next = p.path.shift();
  if (!next) {
    p.stepMs = 0;
    return;
  }
  const diag = next.x !== p.x && next.y !== p.y ? Math.SQRT2 : 1;
  const speed = tileSpeed(c.world, next.x, next.y) || 1;
  const slow = p.needs.rest < 10 ? 1.4 : 1;
  p.nx = next.x;
  p.ny = next.y;
  p.stepMs = Math.round((STEP_MS * diag * slow) / speed);
  p.stepLeft = p.stepMs;
  p.face = faceOf(next.x - p.x, next.y - p.y, p.face);
}

/** Start walking to a tile. False when there is no way. A person already there does not move. */
export function walkTo(c: Ctx, p: Person, tx: number, ty: number): boolean {
  if (p.x === tx && p.y === ty) {
    p.path = [];
    return true;
  }
  const path = findPath(c.grid, p.x, p.y, tx, ty);
  if (!path) return false;
  p.hidden = false;
  p.path = path;
  if (path.length > 0) beginStep(c, p);
  return true;
}

/** Advance the step in progress by `dt`; true when a tile was reached this call. */
export function advanceMove(c: Ctx, p: Person, dt: number): boolean {
  p.stepLeft -= dt;
  if (p.stepLeft > 0) return false;
  p.x = p.nx;
  p.y = p.ny;
  p.stepMs = 0;
  p.stepLeft = 0;
  if (p.path.length > 0) beginStep(c, p);
  return true;
}

export function stop(p: Person): void {
  p.path = [];
  p.stepMs = 0;
  p.stepLeft = 0;
}

/** A free tile near a site, so people do not stack up on one spot. */
export function spotNear(c: Ctx, x: number, y: number, r: number): Point {
  for (let i = 0; i < 6; i++) {
    const dx = c.rng.int(-r, r);
    const dy = c.rng.int(-r, r);
    if (isPassable(c.world, x + dx, y + dy)) return { x: x + dx, y: y + dy };
  }
  return { x, y };
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}
