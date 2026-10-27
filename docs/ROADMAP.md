# Hearth and Ash: roadmap

Order chosen with the owner: **agents with dreams first**, then visible construction, then the economy and survival, then orders and reports, then the Outside. Each milestone ends in something playable and checked, and is delivered as one or more pull requests that the owner's reviewing session checks and merges.

## M0: skeleton (copy and wire)

- New monorepo `shared`, `sim`, `server`, `client` with the build, typecheck and test scripts working.
- Copy from the old game: rng, noise, terrain, pathfinding, world grid, art generators, renderer, UI shell, auth, db, gateway skeleton, deploy scripts (see ARCHITECTURE.md reuse map).
- A village-sized generated map and a starting village of hand-placed buildings (a few houses, a field, a well) rendered in the existing iso style.
- The sim as an empty library with `step`, `view`, `serialize`; the server runs it and sends it to the client; pause and speed 1x/2x/4x work end to end.
- Deploy pipeline copied and renamed, a second service beside the old game on port 3100.

Done when: you log in, see the village, pause and change speed, and the server survives a restart with the village intact.

Status: built on the branch `m0-skeleton`; what was copied, adapted and left out, and the measured numbers, are in `docs/notes/m0.md`.

## M1: villagers with dreams

- About 12 villagers with needs (food, water, rest, warmth, company), skills, traits, relationships and one or two ambitions each.
- The action library (first 30 to 40 actions) and the GOAP-lite planner; a job board with a few standing jobs (farm, haul water, chop wood, cook).
- People change jobs, form friendships and rivalries, fall in love and marry, get ill, age, are born; ambitions that do not need construction come true or fail (learn a skill, open a stall, leave for the Outside, take revenge, win a duel for honour).
- Ambitions that need a building (my own house) post a request and wait.
- Client: a villager sheet showing needs, mood with causes, ambitions, relationships and the current plan with its reasons; an events feed.
- `scripts/bench.ts` and a first `scripts/soak.ts`.

Done when: left alone for a game year at 4x, the village is visibly alive (people work, rest, talk, change), the villager sheet explains why each person acts, and the bench is inside budget at 12 and 60 people.

Status: built on the branch `m1-villagers` (stacked on `m0-skeleton`); what was built, what differs from the spec and the measured numbers are in `docs/notes/m1.md`.

## M2: visible construction and demolition

- Plots, build and demolish orders, the job board feeding builders, materials and stockpiles.
- Construction stages with real sprites (marked plot, cleared ground, foundation, frame, walls, roof, done), scaffolding, material piles, builder animations; demolition in reverse with salvage and rubble.
- Building types for the first set: house, field, well, storehouse, workshop, shrine, watch post, wall segment.
- Ambitions like "my own house" are fulfilled through the manager's orders or the villagers' own labour (a villager may build on a plot you gave them).

Done when: ordering a house shows people fetching materials and the house rising stage by stage; demolishing one takes it down in reverse; progress shows in the orders panel.

Status: built on the branch `m2-construction`; what was built, what differs from the spec and the measured numbers are in `docs/notes/m2.md`.

## M3: economy, seasons and survival

- Production and consumption of food, wood, stone, cloth; stockpiles, spoilage, rationing.
- Seasons and weather, with winter as the main pressure; cold and hunger affect health and mood.
- The events director: bad harvest, Blight creep, a bandit raid, plague, refugees, a travelling master; the first raid reuses the old skirmish ideas.
- Defence: a watch, gates and walls matter.
- Soak tuning so a reasonable player survives several years.

Done when: the soak script shows survival rates in a sensible range across seeds, and a winter without preparation hurts while a prepared village comes through.

Status: built on the branch `m3-economy` (written in the owner's main session, not a cloud session); what was built, what differs from the spec and the measured numbers are in `docs/notes/m3.md`.

## M4: orders, rules and reports

- The rules editor (condition, action) and priority sliders; rules are what runs the village while you are away.
- Daily and seasonal reports with causes; the "While you were away" report; the away policy (cap, throttle, mild events, crisis state).
- Nightly backups and the restart policy on the home server.

Done when: you can set rules, close the game for an evening, come back to a report that explains what happened, and the village did something sensible in between.

Status: built on the branch `m4-orders-rules-reports` (written in the owner's main session); what was built, what differs from the spec and the measured numbers are in `docs/notes/m4.md`.

## M5: the Outside and polish

- The abstract town: trade, envoys, emigrants and newcomers; some events send people out of the map and bring news or goods back.
- Settlement tiers (hamlet, village, town) with unlocks.
- Balance, art polish, tutorial hints, accessibility.

Status: built on the branch `m5-the-outside` (stacked on `m4-orders-rules-reports`, written in the owner's main session); what was built, what differs from the spec and the measured numbers are in `docs/notes/m5.md`. New art and sound are not done.

## Detailed specs

- M1: `docs/notes/m1-agent-brain-spec.md` (the villager brain, needs, skills, traits, ambitions, actions, planner, job board, villager sheet, acceptance).
- M2: `docs/notes/m2-construction-feasibility.md` (a tested way to draw buildings under construction, with `docs/notes/img/construction-feasibility.png`).
- M3 and balance for all milestones: `docs/notes/balance-v0.md` (time scale, food, winter, construction costs, population, survival targets).

## How the work is split

- Design, review and merging: the owner's main session.
- Building: cloud sessions, one per milestone (or per part of a milestone), each opening a pull request against `main`. M1 can split into the agent brain (`sim`) and the villager sheet UI (`client`); M2 into construction logic (`sim`) and construction art (`client/art`).
- Rules for every session: branch from the latest `main`; no deploy; no merge; commits as the owner with no AI attribution; typecheck, tests and build must pass; report measured numbers (bench, soak) in the pull request.
