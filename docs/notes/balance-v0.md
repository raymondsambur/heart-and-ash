# Balance sheet v0: survival numbers

Starting values for M1 to M3, chosen so the first year is hard but fair. Everything here is a tuning knob, kept in one data file (`packages/shared/src/data/balance.ts`) so the soak script can sweep it. Units are stated everywhere; when a number is a guess it says so.

## 1. Time

| quantity | value | real time at 1x | at 4x |
|---|---|---|---|
| game hour | 15 real seconds | 15 s | 3.75 s |
| game day (24 h) | 360 real seconds | 6 min | 1.5 min |
| season | 24 days | 2.4 h | 36 min |
| year (4 seasons) | 96 days | 9.6 h | 2.4 h |

A new village starts on spring day 1. Winter is days 73 to 96 of the year. Most players will play at 2x or 4x, so a year takes 1.2 to 2.4 real hours.

## 2. People and food

The unit of food is a **ration** = one adult's food for one day (about three meals, 4.0 needs points per game hour x 24 = 96 points). Children eat 0.6, the old 0.8.

| quantity | value |
|---|---|
| ration per adult per day | 1.0 |
| 12 people (8 adults, 3 children, 1 elder) | about 10.2 rations a day |
| one year of food for 12 people | about 980 rations |
| spoilage of stored raw food | 0.4% per day (cold store: 0.15%) |
| cooked meals | +10% mood, +15% nutrition per ration |
| water | 1 drink = 40 points, about 3 drinks a day; a well removes the walk to the stream |

**Starting stockpile (guess):** 130 rations, 70 wood, 50 stone, 20 planks, 10 thatch. That is about 12 days of food: enough for the first spring while the first field grows, not enough to coast.

## 3. Production (per skill level 4 worker unless stated)

| source | output | notes |
|---|---|---|
| field, 5 x 5 tiles | 150 rations per harvest at skill 4, two harvests a year (early summer, autumn); yield `x (0.6 + 0.1 x skill)` and `x weather` | crops need tending: neglected fields lose up to 40% |
| foraging (herbs, roots) | 3 rations a day in spring to autumn, 1 in winter | also herbs for healing |
| hunting | 5 rations a day in good weather, risky (wound chance 4% per trip) | needs a bow or spear |
| fishing | 3 rations a day, needs the stream | |
| wood cutting | 14 wood a day | |
| quarrying stone | 8 stone a day | |
| cooking | no output, converts raw to cooked | |

A starting village of two fields and a handful of foragers and hunters should supply about 55% of its food from the fields, 25% from foraging and hunting, and the rest from the stockpile in year one.

## 4. Winter

| quantity | value |
|---|---|
| farming and foraging in winter | none, and hunting at 30% |
| wood for heating | 6 wood per house per winter day, 2 per night in spring and autumn |
| 12 people in 4 houses, one winter | 4 x 6 x 24 = 576 wood |
| cold | at temperatures under 0 an unheated person loses 6 warmth points per hour; clothing halves it; a fire or shelter stops it |
| winter food need | 24 days x 10.2 = about 245 rations |

To survive the first winter the village needs, by day 72, roughly: 245 rations stored (autumn harvest plus the stockpile) and 576 wood (about 41 worker-days of cutting), plus warm clothing for everyone. A village that does nothing special runs short by midwinter. A village that follows the obvious plan (cut wood in autumn, harvest and store food) finishes winter with 20 to 40 rations spare.

## 5. Construction (labour in person-hours at skill 4; materials; stage split)

| building | materials | labour | notes |
|---|---|---|---|
| house (3 x 3) | 30 planks, 12 stone, 6 thatch | 120 | sleeps 4 |
| field (5 x 5) | none | 20 | clearing and ploughing |
| well | 20 stone | 30 | |
| storehouse (4 x 3) | 40 planks, 10 stone | 100 | cold-store upgrade later |
| workshop (3 x 3) | 50 planks, 20 stone | 140 | enables smithing, crafting |
| shrine (2 x 2) | 15 planks, 25 stone | 80 | mood and calm |
| watch post | 30 planks, 10 stone | 70 | |
| wall segment (4 tiles) | 16 stone, 8 planks | 60 | |

Stage split for a house: clearing 5%, foundation 15%, frame 25%, walls 30%, roof 25% (of labour). Builder speed is `1 + 0.08 x building skill`; three builders at skill 4 raise a house in about 30 hours, which is about 1.2 game days (7 real minutes at 1x). Materials must be delivered before their stage starts.

Demolition takes 40% of the build labour and returns 50% of the materials (thatch and planks spoil more: 30%).

## 6. Population

| quantity | value |
|---|---|
| marriage ages | 16 and up |
| a married couple with a home and food | one child about every 2 game years (190 days) on average |
| coming of age | 14 |
| old age | frailty from 60; death risk per year 5% at 60, 15% at 70, 40% at 80 |
| illness | winter cold: 6% per unheated person per winter; plague event 1 in 6 years |
| newcomers | 0 to 2 a season from the Outside, more with food and safety |

## 7. Pressure from outside (M3 baselines)

| event | first possible | strength | notes |
|---|---|---|---|
| bandit raid | year 1, summer | 3 to 5 raiders, about 1 per season after | defended by the watch and armed villagers; loot and wounds |
| Blight creep | from the start, slow | the edge advances about 1 tile a month | contaminates food and water inside its reach |
| bad harvest | year 1, autumn | -30% yield | 1 in 5 harvests |
| plague | year 2 | 3 to 6 sick | healers and rest reduce deaths |
| refugees | any season | 2 to 5 people | accept or refuse; each choice has costs |

The events director raises these only when the village is strong (food days above 20, watch of 4 or more); it sends mild events only while the player is away.

## 8. Survival targets for the soak script

With a simple scripted "reasonable player" (build fields, houses, a well, store food, cut wood), over 20 seeds and 5 game years:

| metric | target |
|---|---|
| survive year 1 | 90% or more |
| survive year 3 | 70 to 85% |
| survive year 5 | 50 to 70% |
| population after year 5 (of survivors) | 20 to 40 |
| a "do-nothing" player survives year 1 | under 10% |
| deaths from starvation in year 1 (survivors) | under 2 on average |

If the soak lands outside these bands, tune in this order: starting stockpile, field yield, winter wood use, raid strength, then birth rate.

## 9. Open numbers (to decide when we can play it)

- Whether 96 days is the right year, or whether seasons of 18 days play better.
- How fast the first fields should fill: if the first spring feels dull, cut the starting stockpile or speed up growth.
- How punishing starvation and cold should be before a person leaves instead of dying.
