# Hearth and Ash (working title)

A single-player village-keeper game set in the Murim Apocalypse world. You manage a village that grows into a town, give orders and read reports, and your people live their own lives while the Blight, winter and bandits press in. Survive.

Status: milestone M0 (the skeleton) is built. You can register, log in, see a small village with twelve placeholder villagers, pause and change the speed (1x, 2x, 4x), and the server keeps the village across restarts. Start with `docs/GAME_DESIGN.md`, then `docs/ARCHITECTURE.md` and `docs/ROADMAP.md`; `docs/notes/m0.md` says what M0 contains.

This is a separate project from `murim-apocalypse-web`, from which code and art are copied as listed in the architecture document.

## Run it

Needs Node.js 22.13 or newer.

```
npm ci
npm run dev          # server on :3100 and the Vite client on :5173 (open the client address)
npm run typecheck && npm test
npm run build && npm start     # the production build: the server also serves the client on :3100
npm run bench        # milliseconds of simulation per game day at 12, 60, 150 and 300 people
```

`http://localhost:5173/?mock=1` runs the client against an in-browser mock of the server (the real simulation library runs in the page; no Node server needed).

## Layout

| folder | role |
|---|---|
| `packages/shared` | types, protocol, rng, noise, pathfinding, world generation |
| `packages/sim` | the deterministic simulation library (no sockets, timers, files or wall clock) |
| `packages/server` | Fastify and `ws`, accounts, SQLite persistence, the tick loop |
| `packages/client` | Vite, the Canvas2D isometric renderer, procedural art, the UI |
| `deploy`, `scripts/deploy.ps1` | deployment to the home server (run by the owner, never by a cloud session) |

There are no npm workspaces (the old game's developer drive cannot make symlinks): `@hearth/shared` and `@hearth/sim` are path aliases in `tsconfig.base.json`, `vitest.config.ts` and `packages/client/vite.config.ts`.

Server settings come from the environment (`PORT` 3100, `DB_PATH`, `WORLD_SEED`, `COOKIE_SECURE`, `AUTOSAVE_MS`, `AWAY_CAP_HOURS` which is a stub until M4); see `packages/server/src/config.ts` and `deploy/README.md`.
