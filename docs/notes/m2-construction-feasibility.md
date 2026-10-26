# M2 feasibility: can buildings be drawn under construction?

**Verdict: yes, with the existing building code.** A one-evening test drew one house at eight stages from the old game's art kit. Image: `img/construction-feasibility.png`. Script: `construction-feasibility.script.ts` (it ran inside the old repo, `scripts/`, with `npx tsx --tsconfig packages/server/tsconfig.json`; paths in it point at that repo).

## What the test did

The old game draws every building as real 3D geometry (`art/mesh.ts` `Scene3D`) from parts in `art/arch.ts`: `plinth` (foundation), `walls(u0, v0, u1, v1, z0, z1, spec)` (the two visible wall faces between two heights), `pillar`, `door`, `roof`. Most building kinds go through one helper, `basic()` in `art/buildings.ts`, which calls those parts in order. Because `walls` takes a height range, a building under construction is the same drawing with smaller numbers.

Eight stages of one 3 x 3 house, left to right:

1. staked plot: four corner stakes;
2. foundation: the stone plinth plus a pile of timber beside it;
3. frame: corner and mid posts up to full height, bamboo scaffolding around it;
4. walls at 40% of their height (posts at full height);
5. walls at 100% with the door;
6. roof 60% open;
7. roof 20% open;
8. finished (the normal `genBuilding` sprite, for comparison).

Everything came out of the existing renderer in the same pixel style, lighting and outline as finished buildings.

## What worked

- **Foundation, frame, walls rising:** read clearly and need no new engine code.
- **Bamboo scaffolding** (poles, rails, one plank level) looks right for wuxia and tells the player at a glance that work is going on.
- **A timber pile** beside the plot is cheap and reads well; the same trick works for stone and thatch piles.
- **Cost:** a sprite is a few milliseconds to draw. Cache by (kind, building id, stage, sub-step). With four sub-steps per stage a building needs about 12 to 16 sprites, drawn lazily the first time they are seen.

## What did not work yet (do these in M2)

- **The roof stage.** The test used the roof's existing `holes` setting, which scatters random holes. It reads as a damaged roof, not a roof being laid. Needed: a `cover` setting (0 to 1) that tiles the roof row by row from the eave upward and draws the uncovered part as bare rafters and battens, so the roof visibly fills in.
- **Cleared ground stage:** between "plot marked" and "foundation", the tiles should change (dug earth, stakes with cord). That is a terrain overlay, not a building sprite.
- **Door and windows** appear only when their wall height is reached; the test only did the door.
- **Kinds that are not `basic()`:** pagoda, hall, dojo, tower and the compound buildings build in several storeys or custom ways. For them the stages are per storey (foundation, storey 1 frame, storey 1 walls, storey 2...). The first M2 set (house, storehouse, workshop, shrine, watch post, wall segment) is mostly `basic()`-style, so start there.
- **Fields and wells** are not buildings in the 3D sense: a field goes through ploughed, sown, growing, ripe on the terrain; a well through a ring of stones rising, then the roof and bucket.

## Builder animation and props (separate art work)

- Character poses needed: carry (a log or a stone on the shoulder), hammer, saw, lay tile, dig. The old game's character art already has tool poses for farm, forge, brew, gather and mine; new ones follow the same pattern in `art/anim.ts`.
- Props: timber, stone, thatch and tile piles, a sawhorse, a dropped rubble pile for demolition.
- Demolition: the same stages in reverse (roof off, walls down, frame, foundation), ending in a rubble sprite that is then cleared.

## Recommended implementation shape for M2

1. A `genConstruction(spec, stage, subStep)` next to `genBuilding`, sharing its geometry parameters (footprint, wall height, roof rise) so a stage always matches the finished building exactly.
2. Make `basic()` take an optional construction state, so every `basic()`-based kind gets stages for free.
3. A pure `blueprint` table in the sim (stages, materials per stage, labour per stage); the client reads `stage` and `progress` from the sim's building state and picks the sprite. The client holds no construction rules.
4. Tests: each stage sprite is inside the finished building's bounding box, sprites are deterministic, and the stage sequence is monotonic (more drawn at each step).
