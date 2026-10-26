# Hearth and Ash (working title): game design

A single-player village-keeper game in the world of Murim Apocalypse (wuxia plus a spreading Blight). You manage one village. It starts small, grows into a town, and has to survive. You give orders and read reports; the people live their own lives.

This document is the shared picture of the game. Decisions that are still open are in "Open questions" at the end. Where a rule names a number, it is a starting value to tune.

## Pillars

1. **Steer, do not puppeteer.** You never move a villager or a building. You place orders (build, demolish), set standing rules and priorities, and read reports. Everything else happens because people want it to.
2. **Everyone has a life.** Villagers have needs, skills, traits and ambitions. They can change jobs, fall in love, start a business, quarrel, leave for the outside, or break your rules, as long as there is a way to do it.
3. **Work is visible.** Nothing pops into existence. Builders walk to the plot, haul materials and you watch the building rise, stage by stage. Demolition runs the same way in reverse.
4. **Survive.** The first goal is to survive: winter, hunger, the Blight, bandits, plague. A village that is well run survives; a village that is badly run, or unlucky, shrinks and may die.
5. **Readable cause and effect.** When prosperity drops or someone leaves, the report says why, in plain words, and you can click a person to see their reasons.

## The player

You are the person who manages the village (a headman, steward or magistrate; the fiction stays loose). There is no walking character and no combat hero.

You can:

- **Order a building built.** Choose a plot and a building type; the village's workers build it when they have labour and materials. You cannot move a finished building.
- **Order a building removed.** Workers take it down, salvage part of the materials and leave rubble that is cleared later.
- **Set priorities.** How much of the village's labour should go to food, wood, stone, building, defence, healing.
- **Set standing rules** (condition, then action), the same idea as the combat tactics of the old game. Examples: "If grain reserve is under 8 days, send builders and idlers to the fields", "If bandits are sighted, the watch assembles at the gate", "In winter, ration food to 80%". Rules are how the village looks after itself while you are away.
- **Read reports.** A daily and a seasonal report, an events feed, and per-person sheets.
- **Decide events.** Big events ask for a choice (an envoy demands tribute, refugees arrive, a bandit chief offers terms).
- **Control time.** Pause, 1x, 2x, 4x. Orders can be given while paused.

You cannot: move buildings, give a single villager a direct command, fight, or trade by hand. (You can set a rule or a priority that influences a person, and a person may follow it or not.)

## The villagers

Every villager is a full simulated agent, always, at any speed. The village is small enough for that (about 12 people at the start, perhaps 150 at the end).

- **Needs:** food, water, rest, warmth, safety, company, purpose. Unmet needs cause mood loss, illness and, in the extreme, death.
- **Skills:** farming, hunting, woodcraft, mining, building, smithing, cooking, healing, teaching, trading, fighting and others. Skills improve with use. A villager can learn anything; some are quicker at some things.
- **Traits:** a handful per person (honest, lazy, brave, greedy, devout, curious...). Traits change choices, not just numbers.
- **Ambitions (dreams):** each person has one or two long-term goals, and a goal can change with life events. Examples: build my own house, marry, open a stall, become a master of the sword, protect the village, get rich, see the outside world, take revenge on the man who cheated me. An ambition becomes a goal the person pursues in spare time, and it can cost the village labour or create friction.
- **Relationships:** family, friends, rivals, lovers. People talk, gossip and remember (the memory and rumor ideas of the old game carry over).
- **Loyalty:** how much a villager trusts the manager. Low loyalty means ignoring rules, grumbling in reports, or leaving.
- **Life events:** birth, coming of age, marriage, illness, injury, old age, death, emigration, arrival of newcomers.

### "As long as there is a way, they can do it"

Freedom is delivered by an **action library** (see ARCHITECTURE.md): many small actions with requirements and effects (plant, harvest, chop, haul, build, cook, heal, teach, court, trade, steal, patrol, leave, return, pray...). People choose goals from their needs, orders and ambitions, and plan a path of actions to get there. New actions are data, so adding one adds possibilities everywhere. The promise is breadth: a person can pursue any goal whose actions exist and whose requirements the world can meet, not a fixed script.

## The village and the world

- **The map:** a small playable area around the village (to begin with, about 96 x 96 tiles): fields, forest, a stream, stone outcrops, the Blight at the edges. The old game's isometric pixel art and terrain are reused.
- **The Outside:** a town (later more) beyond the map is not drawn. It exists as an abstract place that trades, sends envoys and rumours, takes emigrants and sends newcomers. Caravans and travellers leave the map and come back with results.
- **Seasons and weather:** spring to winter. Winter is the main pressure: cold, no growth, food running down.
- **Growth:** the settlement has a tier (hamlet, village, town) that rises with population, buildings and prosperity and unlocks plot types and rules.

## Survival: threats and the director

An **events director** paces the pressure so the village is challenged without being crushed:

- winter cold and hunger, bad harvests;
- the Blight creeping closer, Blighted food and water, hollow creatures at the edge;
- bandit raids and wandering monsters (the old game's raid and skirmish ideas);
- plague;
- internal trouble: feuds, theft, a charismatic troublemaker;
- opportunities: refugees, a travelling master, a trader with rare goods.

The director reads the village's state (strength, food, morale) and picks events with weights; a stronger village gets harder events.

**Win and lose (first version):** survive as long as you can. The score is years survived, peak population and prosperity. The village is lost when nobody is left. Later scenarios can add goals (reach town tier, seal a Blight heart, host a tournament).

## Construction

- A **plot** is a rectangle you designate for a building type (house, farm field, well, storehouse, workshop, shrine, watch post, wall, barracks...).
- Construction needs **materials** (timber, stone, thatch...) in the village stockpile or brought from the world, and **labour** from villagers with the right skills.
- Stages: marked plot, cleared ground, foundation, frame, walls, roof, finished. The sprite really changes at each stage, scaffolding stands around it, material piles sit beside it, and builders animate (carry, hammer, saw).
- Progress is shown on the building (a small bar and the stage) and in the orders panel.
- Demolition: workers pull the building down in reverse stage order, salvage some materials, leave rubble, clear it.
- The art direction: buildings are already drawn by a procedural 3D process; partial construction is the same geometry cut at a build height plus scaffolding props.

## The interface

- **Village view:** the isometric map, with a build mode overlay (plots, costs, progress), a selection panel and the time controls.
- **Villager sheet:** needs, mood and its causes, skills, traits, ambitions, relationships, what they are doing and why.
- **Orders:** the list of build and demolish orders with progress.
- **Rules and priorities:** a rules editor (condition, action) and sliders.
- **Reports:** daily and seasonal reports with the main changes and their causes; an events feed; the "While you were away" report.
- English only. Desktop first, phone usable.

## Time and being away

- Time controls: pause, 1x, 2x, 4x. A game day lasts about 6 real minutes at 1x (to tune).
- The village runs on the server. While you are away it keeps living, but away time is **capped and throttled** so you never return to a lost village or to years of change: away time passes at 1x for up to 8 real hours (to tune); after that the village waits.
- While you are away the director only draws mild events, and your standing rules do the managing. On return you get a "While you were away" report.
- Nothing about being away is permanent loss of the whole village: if a crisis would end it, the village drops into a "crisis" state and waits for you.

## Not in the first version

Multiplayer, a walking hero or combat controlled by the player, player-to-player trade, more than one village, mobile-first controls, voice or sound (later).

## Open questions

1. Away policy numbers (cap hours, throttle) and whether crisis state should exist.
2. How much of the economy is player-visible (a treasury and taxes, or only stockpiles and rations?).
3. How the "Outside" shows up: only events and reports, or a small map marker you can inspect.
4. How hard the first winter should be for a new village.
5. Naming: the working title is "Hearth and Ash".
