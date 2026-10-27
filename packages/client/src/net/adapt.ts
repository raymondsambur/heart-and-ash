/** Turns protocol views into the entity values the renderer draws. Pure. */
import type { EntityUpdate, EntityView, NpcRole } from '@hearth/shared';
import type { RenderEntity, RenderEntityPatch, RenderState } from '../render/api';

/** Titles shown above a name. */
const ROLE_TAG: Partial<Record<NpcRole, string>> = { elder: 'Elder', guard: 'Watch' };

/** The sim's `rest` is a pose (the `rest` act), not a separate sprite state. */
function renderState(state: EntityView['state']): RenderState {
  return state === 'rest' ? 'idle' : state;
}

export function toRenderEntity(e: EntityView): RenderEntity {
  const r: RenderEntity = {
    id: e.id,
    kind: 'npc',
    name: e.name,
    x: e.x,
    y: e.y,
    face: e.face,
    state: renderState(e.state),
    look: e.look,
    role: e.role,
  };
  if (e.nx !== undefined) r.nx = e.nx;
  if (e.ny !== undefined) r.ny = e.ny;
  if (e.step !== undefined) r.step = e.step;
  if (e.route !== undefined) r.route = e.route;
  if (e.act !== undefined) r.act = e.act;
  const tag = e.role ? ROLE_TAG[e.role] : undefined;
  if (tag) r.tag = tag;
  return r;
}

/**
 * The state of a known entity at the next update. Fields the entity no longer has (it stopped walking, finished an act) are
 * sent as `undefined` so the renderer clears them.
 */
export function toRenderPatch(u: EntityUpdate): RenderEntityPatch {
  return { id: u.id, x: u.x, y: u.y, nx: u.nx, ny: u.ny, step: u.step, route: u.route, face: u.face, state: renderState(u.state), act: u.act };
}
