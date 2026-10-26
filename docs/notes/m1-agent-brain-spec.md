# M1 spec: the villager brain

Target: milestone M1 of `docs/ROADMAP.md` ("villagers with dreams"). This is the detailed spec for the simulation side (`packages/sim`, data in `packages/shared`) and for the villager sheet in the client. Numbers are starting values to tune with the soak and bench scripts. When a rule here conflicts with `docs/GAME_DESIGN.md`, the design document wins and this one gets fixed.

## 1. The promise and its honest limits

Promise: every villager is a free agent. They pursue what they need and what they dream of, by any route the world allows; the manager can steer but never puppeteer.

Honest limit: a villager can only do what the **action library** contains and what the world's rules let them achieve. So breadth comes from (a) many small actions that combine, (b) ambitions that can be pursued in several ways, (c) adding an action being a data change that opens new possibilities everywhere. M1 ships about 50 actions and about 25 ambitions. Things that are explicitly NOT in M1: building by villagers (M2), the economy beyond simple stockpiles and barter (M3), rules and priorities UI (M4), the Outside (M5; leaving is modelled as walking off the map edge and being gone).

## 2. Data model (sketch, TypeScript)

```ts
type NeedId = 'food' | 'water' | 'rest' | 'warmth' | 'safety' | 'company' | 'purpose';

interface Person {
  id: number; name: string; look: Look;                 // look: reuse the old paper-doll Look
  born: number;                                         // game day; age derived
  sex: 0 | 1;
  family: { parents: number[]; partner: number | null; children: number[] };
  home: BuildingId | null;                              // where they sleep; null = homeless
  pos: { x: number; y: number }; facing: Dir;
  needs: Record<NeedId, number>;                        // 0..100, 100 = fully satisfied
  health: { hp: number; maxHp: number; ills: Ill[]; wounds: Wound[] };
  skills: Record<SkillId, { lv: number; xp: number }>;  // lv 0..20
  traits: TraitId[];                                    // 2..5
  ambitions: Ambition[];                                // 0..2 active
  loyalty: number;                                      // 0..100, towards the manager
  mood: number;                                         // derived 0..100 with a list of causes
  relations: Record<number, Relation>;
  memory: Memory[];                                     // bounded, see 7
  knowledge: Knowledge;                                 // places and resources they know of
  inventory: ItemStack[]; carrying: ItemStack | null;
  goal: GoalStack;                                      // current goal and what interrupted it
  plan: Plan | null;                                    // list of action instances with state
  why: DecisionRecord;                                  // explanation, see 9
  schedule: PersonalRhythm;                             // sleeps early/late, etc. (small offset)
}
```

All of this is serialisable, versioned, and deterministic (one seeded rng, no wall clock).

## 3. Needs

Each need is 0..100 (100 satisfied). Rates are per game hour (a day is 24 game hours).

| need | falls by | restored by | at < 30 | at < 10 |
|---|---|---|---|---|
| food | 4.0 | eat (a meal gives 30 to 45, so about 2.5 to 3 meals a day) | mood malus, slower work | weak, illness risk, starvation damage |
| water | 5.0 | drink (a drink gives 40) | mood malus | dehydration damage |
| rest | 4.2 awake | sleep (+12 per hour) | slower work, errors | collapses where they stand |
| warmth | by temperature, clothing, shelter, fire | fire, shelter, clothing | mood malus | frostbite, illness |
| safety | events (threat seen, raid, wound) | recovery over time near others or indoors | anxious, avoids outdoor jobs | panic, flees |
| company | 0.8 | chatting, working beside friends, festivals | lonely | withdrawn, refuses jobs |
| purpose | 0.5 | progress on a job or ambition, being thanked | idle and sullen | drifts, may leave |

Mood = a weighted mean of needs plus the sum of recent mood events (a good meal, a quarrel, a death), shown with its three largest causes. Needs fall in order of urgency; the thresholds above feed the goal system (section 6).

## 4. Skills

15 skills, level 0..20, `xp` to next level = `40 * (lv + 1)^1.4`. A skill grows with use, faster with a teacher present, with the trait `fast learner`, and when young; very old people learn slowly.

farming, foraging (herbs, roots), hunting, woodcraft, mining (stone and ore), building, smithing, cooking, crafting (cloth, tools), healing, teaching, trading, fighting, scholarship, leadership (speech).

Skill effects: speed (`1 + 0.08 * lv`), quality and yield, success chance of risky actions, and which actions are allowed (some require a minimum level). People start with a few skills at 2 to 6 from their family trade.

## 5. Traits

2 to 5 per person, drawn at birth with some inheritance from parents. A trait changes choices, not just numbers. Each has a list of tags that actions and goals read.

hardworking, lazy, brave, cowardly, honest, cunning, kind, cruel, greedy, generous, curious, devout, superstitious, proud, humble, gregarious, solitary, hot-tempered, calm, ambitious, content, observant, clumsy, strong, frail, fast learner, stubborn, loyal, rebellious, romantic.

Examples: `lazy` scores rest and leisure higher and work lower; `cowardly` refuses risky jobs and flees early; `cunning` unlocks steal and deceive with better odds and lower guilt; `devout` seeks the shrine and is calmer in a crisis; `rebellious` lowers compliance and raises the chance of open defiance; `gregarious` loses company slowly... no, quickly, and gains more from socialising.

## 6. Goals: where a person's day comes from

A person always holds one **current goal**. It comes from one of six sources, checked in this order of priority (the first three can interrupt anything):

1. **Danger:** a threat in sight, fire, collapse: flee, help, defend (brave and trained people defend; cowards flee).
2. **Critical needs:** any need under 10.
3. **Emergencies posted by the manager** (later milestones).
4. **Jobs from the job board** (section 8), when the person is willing and able.
5. **Ambition work** (section 10) in spare time.
6. **Leisure and social:** chat, rest, pray, wander, play.

Within a source, goals are scored: `score = base * urgency(need) * traitFit * skillFit * (1 / (1 + distance/20))`. `urgency` rises steeply as a need falls (a convex curve, for example `((100 - need) / 100)^2 * 3`). To avoid dithering a person keeps a goal for a minimum time (about 20 game minutes) unless an interrupt source fires, and switches only if the new goal beats the current one by 25%.

## 7. Memory and knowledge

- **Memories:** at most 40 per person; each has `{what, who, where, when, valence, weight}` and decays (weight halves every 20 game days unless reinforced). Salient things are remembered: a theft, a rescue, a death, a gift, a betrayal. Memories feed opinions, grudges, revenge ambitions, gossip and the villager sheet.
- **Knowledge:** the places a person has seen (fields, forests, ore, water, buildings) and who they think lives where. Knowledge spreads by talking, so a newcomer or a loner knows less. Planning only uses what the person knows.
- Adapt the old game's memory and rumor code (`packages/server/src/npcmemory/*`) for gossip: facts spread along friendships with some distortion.

## 8. The action library

Data table in `packages/shared/src/data/actions.ts`. An action template has: `id`, `verb` (display text), `requires` (location, items, tool, minimum skill, time of day, relationship), `effects` (items made and used, skill xp, need changes, relationship and memory changes, world changes), `cost` (game minutes, energy, risk), `skill` (which skill speeds it and which grows), and `where` (a place type the planner can resolve to a tile).

The first set (about 50):

| group | actions |
|---|---|
| survival | eat, drink, sleep, warm up at a fire, light a fire, seek shelter, dress for cold, treat own wound |
| food and materials | plant, tend crops, harvest, forage herbs, hunt, fish, chop wood, saw planks, quarry stone, mine ore, haul item, store item, take from store |
| crafting | cook, brew wine, make a tool, smith a blade, weave cloth, sew clothing, repair tool |
| care and learning | heal, nurse the sick, teach a skill, study (scholarship), pray at the shrine, mourn, bury the dead |
| social | chat, gossip, help with work, court, propose, marry (ceremony), quarrel, apologise, gift, barter, tell a story, celebrate, comfort |
| conflict and crime | brawl, duel for honour, steal, deceive, threaten, sabotage, neglect duty, flee, fight raiders (M3 uses this) |
| duty | patrol, stand watch, report for work |
| life | leave the village, return, give birth, grow up, fall ill, recover, die |
| construction (stubs for M2) | build, demolish, clear rubble, fetch material (present but inactive in M1) |

The planner (next section) combines these. Adding an action means adding a row; the UI shows its `verb` so new actions appear in explanations without UI work.

## 9. Planning, jobs and explanations

**Planner (GOAP-lite).** Given a goal such as `have food >= 60`, the planner searches sequences of action templates (depth at most 6, at most 200 nodes expanded) over an abstract state: where the person is (as a place type), what they carry, what they know exists, what is in reach. Preconditions that fail become sub-goals (no food in the store, so forage, so go to the forest I know). Plans are cached by (goal, coarse state, person-class) and re-validated cheaply; a person re-plans when a precondition breaks, a higher source interrupts, or the plan has run its course. If no plan is found three times in a row the goal is marked `blocked` with a reason ("no known source of water"), the person picks another goal, and the reason appears in the report ("Wen cannot find a way to do 'repay the debt': no money, no work he is willing to do").

**Job board.** Open work is posted as jobs: `{id, type, place, minSkill, priority 1..5, claimedBy, progress}`. In M1 the posters are the village's standing production (farm, water, wood, cooking) and haul and store tasks created by the actions themselves; M2 adds build and demolish orders and M4 adds the manager's priority sliders as multipliers per job type. A free person scores open jobs by skill, distance, priority, traits and mood and claims one. **Compliance:** the chance to take or keep a job is `clamp(0.25 + loyalty/150 + mood/300 + traitBonus - jobRisk(courage) - ambitionConflict, 0.05, 0.98)`. A refusal records its reason ("refused to haul stone: exhausted", "resents the manager").

**Explanations.** Every decision stores `{goal, source, topThreeScores, planSummary, blockedBy?}` in `person.why`. The villager sheet shows it in plain words. Reports quote it. Never ship an action whose reason cannot be put in a sentence.

## 10. Ambitions (dreams)

An ambition is `{id, kind, params, progress 0..1, startedDay, stuck?}`. At coming of age (14) and after major life events a person gets 0 to 2 ambitions chosen by weights from traits, family, skills and circumstances. An ambition produces **goals in the ambition source** (section 6) whenever the person has spare time, and updates its progress from milestones, not from a bare timer. It can be fulfilled (mood and loyalty boost, a feed entry, sometimes a new ambition), abandoned (a memory and a mood hit), or changed by events.

First catalogue (about 25):

| ambition | milestones (examples) | notes |
|---|---|---|
| own a house | save materials or labour, ask for a plot (posts a request, waits for M2) | needs M2 to finish |
| marry | find a compatible person, court, propose, ceremony | uses relationships |
| raise children | marry, home, food surplus | births are real |
| open a stall | make goods, set up a blanket stall at the plaza, sell | works without buildings |
| become a master (skill) | reach skill 12 in a chosen skill, teach one apprentice | per skill |
| take an apprentice | teaching skill, find a willing youth, teach | links two lives |
| protect the village | train fighting, join the watch, stand watch | feeds defence |
| get rich | earn and keep a target amount of silver | greed and risk |
| see the Outside | prepare supplies, leave the village | leaving is real, a person may later return with news |
| take revenge | remember the wrong, find the person, brawl or duel or sabotage | needs a grudge memory |
| win honour | win a duel or a contest, be praised | hot-tempered and proud |
| heal the sick | healing skill, tend the ill | devout or kind |
| build something great (a shrine) | M2 | waits |
| reconcile | apologise to a rival, gift, help | calm and kind |
| be left alone | withdraw, build a hut at the edge (M2) | solitary |
| court a particular person | learn what they like, gifts, time together | romantic |
| find the lost kin | ask newcomers, leave to look | emigration |
| perfect a recipe | cook many times, share the dish | cooking |
| tend a garden or flock | plant, tend, harvest | content people |
| keep the faith | pray, mourn, bless festivals | devout |
| seek the Blight's cure | study, forage herbs near the Blight, risk | scholar |
| earn the manager's trust | follow orders, be thanked | raises loyalty |
| escape debt | work, barter, repay | pressure story |
| be a storyteller | tell stories at feasts | gregarious |
| cheat the system | steal and not get caught | cunning, greedy |

An ambition may pull labour from the village (a farmer practising the sword) or cause friction (a rival's revenge), and both show up in reports. That is intended.

## 11. Relationships, loyalty and life events

- **Relation:** per pair `{familiarity 0..100, affinity -100..100, romance 0..100, last met}`. Every interaction updates them; compatibility comes from traits (a gregarious and a solitary clash; two kind people drift together). Family ties are fixed anchors.
- **Loyalty** (towards the manager) rises with fed, safe, thanked villagers and fulfilled ambitions; it falls with hunger, cruelty (later: harsh rules), unfair treatment and neglected ambitions. Low loyalty means refused jobs, grumbling in reports, desertion at the lowest level.
- **Life events:** birth, childhood (children play and learn from adults near them), coming of age (ambitions drawn), courtship and marriage, illness and injury, ageing (skills slow, strength falls), death and mourning, arrival of newcomers (from a fixed small pool in M1), departure. Deaths are remembered by relatives and friends.
- **Gossip:** an interaction can pass a fact. Facts keep a source and drift in detail. This is the engine of "reputation".

## 12. Time, performance and determinism

- Sim step: 15 game seconds. A game day is 360 real seconds at 1x, so a step is 1/16 of a real second at 1x and 1/64 at 4x.
- A person acts every step (move, work, progress), but **decides** only when their current action ends, an interrupt fires, or every 10 game minutes, staggered by id so the cost is spread.
- Budget (to be measured in `scripts/bench.ts`): with 150 people, one step costs at most 1.5 ms on the server's CPU, planning included. If it does not fit, cache plans and widen the decision interval before cutting features.
- Determinism: all randomness from the one seeded rng, drawn in a fixed order; iteration orders by id; golden tests compare serialised states.

## 13. Client: the villager sheet (M1 UI)

- A villager list panel (sortable by mood, job, age) and click-to-select in the world with a camera follow button.
- The sheet: portrait and name, age and role in plain words, needs as bars with the cause of the lowest, mood with its three biggest causes, skills as a compact list, traits with a tooltip, ambitions with progress and "stuck because...", top relationships, the current action with **Why?** expanded, recent memories, inventory.
- An events feed: births, marriages, quarrels, ambitions fulfilled or abandoned, arrivals and departures, deaths.
- English only. Tooltips explain every number.

## 14. Acceptance (what M1 must show)

Measured by `scripts/soak.ts` over game years, several seeds, and by looking at the game:

1. **Alive:** people work, rest, talk, change jobs, form friendships and rivalries, court, marry, are born and die of age and illness, not only of bugs.
2. **Ambitions work:** over one game year at least half the ambitions that do not need construction either progress visibly or are abandoned with a recorded reason; at least one of each kind that is possible gets fulfilled across seeds.
3. **No stuck people:** nobody stays in the same blocked state for more than three game days without the reason appearing in the feed.
4. **Explained:** every action in the world can be explained from the sheet in a sentence.
5. **Deterministic:** the same seed and steps give the same serialised village (golden test).
6. **Fast enough:** `scripts/bench.ts` inside the budget at 12 and 60 people, and a measured result at 150.
7. **Tests:** pure unit tests for needs, skills, goal scoring, the planner (including blocked plans), compliance, relationships, ambitions, memory decay and serialisation.

## 15. Example lives (to test the design, not to hard-code)

- **Mei, 23, farmer** (`hardworking`, `kind`, `gregarious`), skills: farming 6, cooking 3. Ambition: **open a stall**. Her days: tend the field when a job is open, cook at home, in spare time make dumplings, then set up a blanket stall at the plaza at midday and barter. The stall succeeds slowly, she gains trading skill, she is thanked, loyalty rises. If food is scarce her ambition is paused by the need system and the feed says why.
- **Wen, 31, drifter** (`lazy`, `cunning`, `greedy`), skills: trading 4. Ambition: **cheat the system**. He takes jobs rarely (low compliance), steals from the store when hungry and unseen, is gossiped about, loses friends; if caught his loyalty collapses and he may leave. A reader of the feed sees the whole story.
- **Old Bao, 67, healer** (`devout`, `calm`, `kind`), healing 14, teaching 8. Ambition: **take an apprentice**. He finds a curious teenager, teaches on quiet afternoons, nurses the sick; when he dies, the apprentice inherits his role and a mourning memory.
