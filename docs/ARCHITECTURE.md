# Hearth and Ash: architecture

The game runs on a server from the start (decided together with the owner). One account owns one village. The simulation is a deterministic library with no I/O so it can be tested, fast-forwarded and, if needed, moved to another host.

## Stack

TypeScript monorepo, copied from and shaped like `murim-apocalypse-web`:

| package | role |
|---|---|
| `packages/shared` | types, protocol, rng, noise, terrain, pathfinding, world grid, action and item data tables, ids |
| `packages/sim` | the simulation: pure, deterministic, no sockets, timers, files or wall clock |
| `packages/server` | Fastify and `ws`, auth, persistence (`node:sqlite`), the tick loop, away policy, reports delivery |
| `packages/client` | Vite, the Canvas2D isometric renderer, procedural art, the management UI |

Node 22 or newer. No new runtime dependency is expected beyond what the old game used (fastify, @fastify/static, ws, zod).

## The simulation (`packages/sim`)

A pure library:

```
const sim = createSim({ seed, saved? });
sim.command(cmd);          // orders from the player: build, demolish, rule, priority, speed...
sim.step(dtGameMs);        // advance by a fixed number of game milliseconds
sim.view();                // data for the client (entities, plots, stockpiles, time)
sim.events();              // reports, feed items, notifications since the last call
sim.serialize();           // full state, versioned
```

- **Deterministic:** one seeded rng, no `Date.now`, no `Math.random`. The same seed and commands give the same village (golden tests rely on it).
- **Fixed step:** the server calls `step` with a constant game-time slice; speed (pause, 1x, 2x, 4x) only changes how many slices run per real second.
- **Budget:** 150 to 300 agents at 4x on the server's CPU with room to spare (target under 20 ms per real second of 1x time, measured by a bench script from day one).
- **State:** a world grid (terrain, plots, blocking), entity tables (people, buildings, items, animals, stockpiles) and global state (calendar, season, weather, Blight, relationships, policy).

### Systems (in the order they run each step)

1. time, calendar, seasons, weather;
2. needs and health (hunger, warmth, rest, injury, illness, ageing);
3. perception and memory (what each person knows and remembers);
4. goals and planning (see below);
5. action execution (movement with the shared pathfinding, work, social acts);
6. construction and demolition (stages, labour, materials);
7. economy (production, consumption, stockpiles, spoilage, the Outside trade);
8. social (relationships, gossip, loyalty, marriage, births);
9. the events director (pressure, raids, plague, opportunities);
10. reports (daily and seasonal summaries with their causes).

### Agents: goals, plans, actions

This is where the "anyone can do anything" promise lives.

- **Action library** (data, in `shared`): each action has preconditions (location, tools, skill level, items, time of day, relationship), effects (items, skill xp, needs, relationships, world changes), a cost (time, energy, risk) and a way to execute. About 60 actions to begin: plant, harvest, chop, haul, mine, hunt, cook, eat, drink, sleep, build, demolish, repair, heal, teach, learn, trade, court, marry, quarrel, steal, patrol, flee, pray, celebrate, leave the village, return, and so on.
- **Goals** come from three sources: needs (urgent, always first), orders and rules from the player (turned into jobs on a **job board**), and the person's own **ambitions**.
- **Planning:** a small goal-oriented planner (GOAP-lite) searches action sequences to satisfy a goal, bounded in depth and cost. A person re-plans when the world changes.
- **Jobs:** the job board lists work that needs doing (a field to plant, a plot to build, wood to haul). People take jobs by skill, priority, distance, traits and loyalty. A person with low loyalty or a competing ambition may refuse.
- **Memory:** each person remembers events and people (the memory and rumor code of the old game is adapted for this).
- **Explainability:** every decision stores its reasons, so the UI can show why someone did something.

### Construction

`shared/data/blueprints.ts` is the blueprint table: per kind the footprint, the labour and the stages with the materials each needs; `canPlace` (shared with the client) says where a plot may go. An order (`st.orders`, `sim/construct.ts`) owns the work: it posts haul and build jobs to the job board, builders deliver material and add labour, stages advance in order, and the finished building takes its role (a home, a second store, a water site, a field). Demolition runs the stages backwards, returns part of the material and leaves rubble. The building or plot carries a small `con` (stage, % of the stage, material on the plot); the client draws from that alone (`art/construction.ts`). The map's own grid is never edited: a dynamic overlay records what now stands.

### Economy and the events director (M3)

`shared/data/balance.ts` holds every tuning number of the economy and the director in one object (`BAL`). `sim/economy.ts` is the village's use of its own stock: the hearths (once an evening every house with people in it burns wood from the store, six a winter day), spoilage (slower in winter and with a second storehouse, faster as the Blight's reach grows), rationing (a level the manager sets that shrinks the portion and what it gives) and the aims the standing jobs work towards (a winter of wood by autumn). `sim/director.ts` runs once a game day: the Blight's creep, bad harvests, plague, refugees, a travelling master and raids. A raid is announced a day ahead, a watch job opens, and on the day the village's defence (people by fighting skill, more for those on watch, plus finished watch posts and walls) is weighed against the raiders. The director keeps its own small state (`st.dir`) in the snapshot (version 4).

### Orders, rules and reports (M4)

`shared/data/policy.ts` holds what the manager's levers are made of: the kinds of work and their priority levels, the rule conditions and actions, decisions (offers) and reports. `sim/policy.ts` applies priorities (a multiplier on how attractive a job is, in `goals.ts`) and runs the standing rules once a game hour. `sim/offers.ts` puts decisions to the manager and settles them by their fallback when nobody answers or the manager is away. `sim/reports.ts` compares the village with a base taken at the start of the day, the season or the away stretch and writes the daily, seasonal and "While you were away" reports with the causes. The host keeps a village running at 1x for `AWAY_CAP_HOURS` after its manager leaves (the director is mild, a village that would be lost parks itself in a crisis state), and resumes away villages after a restart. Snapshot version 5, protocol version 4.

### The Outside

An abstract place (or a few) with its own simple state (wealth, needs, mood towards the village). It produces traders, envoys, emigrants and newcomers, buys and sells in bulk, and receives villagers who leave. It is a data model and an events source, not a map.

## Server (`packages/server`)

- **Accounts:** the old username and password flow (scrypt, HttpOnly cookie) is reused. One village per account for now; the schema allows several saves later.
- **Tick loop:** runs the account's sim at the chosen speed, only while a player is connected or inside the away window.
- **Away policy:** after the last client disconnects the sim keeps running at 1x for `awayCapHours` real hours (default 8), then pauses. The events director switches to mild events while away. A "While you were away" report is built from the events during that time. If a crisis would end the village while away, the sim parks in a crisis state instead.
- **Persistence:** SQLite. A full versioned snapshot every 30 seconds and on every pause or disconnect; commands are applied through the sim and are not stored separately at first. Nightly backups as in the old game (systemd timer).
- **Protocol (WebSocket):** the client sends validated commands (zod) and receives: a full view on connect, then entity deltas about 5 times a second, feed events, reports and notifications. The server is authoritative.
- **Pause and speed** are server state for the village; the client only requests changes.

## Client (`packages/client`)

- The isometric renderer and procedural art of the old game, adapted: terrain chunks, sprite bank, paper-doll people, the building rasteriser. Construction stage sprites with scaffolding, material piles and rubble, builder poses and carried loads, field ground that follows the plots (M2).
- The UI shell (panels, tooltips, toasts, i18n) is reused. Villager sheet, build menu and order list (M2); the village card with days of food and fuel, the rations lever and the alert line (M3); still to come: rules and priorities, reports.
- The client holds no game rules; it draws what the server sends.

## Deployment

The existing server and pipeline are reused: the `hearth-and-ash` service runs beside the old game on the same Ubuntu server, on its own port (3100) with its own data folder (`/var/lib/hearth`), its own release folder and backup timer. The old `npm run deploy` script and `remote-deploy.sh` are copied and renamed. It is reachable on the home network and over Tailscale.

## Testing and tooling

- Unit tests for every pure system; golden snapshot tests for determinism.
- `scripts/soak.ts`: run N game years headless, print survival, population, prosperity and the events that happened, to tune the director.
- `scripts/bench.ts`: ms per game day at 12, 60, 150 and 300 people.
- A sandbox page for the renderer (as in the old game) and a mock server for UI work.

## Reuse map (from `murim-apocalypse-web`)

Status after M0 (see `docs/notes/m0.md` for the exact file lists):

| area | plan | status |
|---|---|---|
| `shared`: rng, noise, terrain types, pathfinding, world grid, ids | copy as is | **Done.** `rng`, `noise`, `pathfinding` are byte for byte the old files. `terrain` types and `worldgrid` are the old ones minus settlements, factions and nodes of the old world. The old game had no separate id helpers (the hash helpers live in `rng`). |
| `shared`: world generation | adapt: a village-sized map, no settlements network | **Done.** `worldgen.ts` is new code on the old noise and stream ideas: 96 x 96, stream, stone outcrops, forest, Blight at the edges, a hand-placed starting village. |
| `shared`: items, jobs, names data | copy and trim | **Names only.** `data/names.ts` is trimmed (person and village names). Items, jobs and skills are left for M3 (economy), because their tables carry the old combat and gear model. |
| `client/art/*` (people, buildings, terrain, props, flora, beasts, sect props, item icons) | copy as is, then add construction stages | **Done except item icons** (`itemicons`, `itemkit`, `itemmisc`) and the sprite-pack importer (`imported`, `spriteimport`), which need the old item and skill data. Everything else is identical to the old files (two small edits: the actor-state and faction types). Construction stages come in M2; goods icons come in M3. |
| `client/render/*` | copy, drop MMO-only parts, add construction and plot overlays | **Done, minus overlays.** Copied and adapted; combat effects, landmark beacons and the old-world minimap are removed. People now move on a sim clock (frozen on pause, 2x/4x faster). Plot overlays and construction come in M2. |
| `client/ui/*` shell, icons, tooltip, i18n | copy | **Done** (trimmed to what the village game uses: DOM helpers, forms, icons, modal, tabs, toast, tooltip, i18n, auth screen, styles). |
| `client/ui/panels/*` | rewrite for the management UI | **Started in M1:** the villager list, the villager sheet and the events feed are new HUD parts (`ui/hud/people.ts`, `sheet.ts`, `feed.ts`). Orders, rules and reports panels come with M2 and later. |
| `server`: auth, db, http, gateway skeleton, deploy scripts | copy and adapt | **Done.** New schema (users, sessions, villages with versioned snapshots), village host and tick loop instead of the old runtime. |
| `server`: npclife, npcmemory, dialogue | adapt ideas and some code: memory, rumors, talk composer | **Ideas used in M1** (`packages/sim/src/memory.ts`, `social.ts`): bounded memories that fade, gossip with distortion, opinions from memories. No code copied; the old files are tied to the MMO. Dialogue text is not built (people talk, the feed reports). |
| `server`: sim (settlements, factions, economy, blight) | mine for ideas: economy goods, Blight spread, seasons; mostly rewrite | **Seasons and weather done** (the old weather chain is reused for one climate). Economy, Blight spread and the rest come in M3. |
| `server`: combat, monsters, siege, missions, sects, masters, duels, friends | leave behind (raid and skirmish ideas return later as events) | **Left behind.** |

## Risks

- **Agent planning cost:** keep planning bounded and cached; measure from the first milestone.
- **Emergent chaos:** if everything is possible, balance is hard. Mitigate with the soak script, a conservative events director and clear reports.
- **UI scope:** the management UI is large; build it in vertical slices alongside each system.
- **Server uptime:** it is on the owner's home server; backups and a restart policy are part of the first deploy.
