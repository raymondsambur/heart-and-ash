# Running Hearth and Ash on the home server

Hearth and Ash runs as its own systemd service beside the old game on the same Ubuntu server. It has its own user,
program folder, data folder, port and backup timer, and no step here touches the old game.

| | Hearth and Ash | 
|---|---|
| service | `hearth-and-ash` |
| program folder | `/opt/hearth-and-ash` |
| data (SQLite) | `/var/lib/hearth/hearth.db` |
| port | `3100` |
| backups before each deploy | `/var/backups/hearth/<timestamp>/` (newest 10) |
| nightly backups | `/var/backups/hearth-nightly/` (newest 14) |
| settings file (optional) | `/etc/hearth-and-ash.env` |

Cloud sessions never deploy. Deploying is done by the owner from the Windows PC.

## Deploying changes (from the dev computer)

```
npm run deploy                 # type check, tests, build, upload, swap, health check
npm run deploy -- -SkipTests   # same without the tests
npm run deploy -- -Server 192.168.1.17   # force an address (default: Tailscale, then the home address)
```

`scripts/deploy.ps1` checks and builds locally, then uploads the release over SSH and runs
`deploy/remote-deploy.sh` on the server. The SSH key is the one of the shared server (`~/.ssh/murim_server` by default,
user `ray`); set `HEARTH_DEPLOY_KEY` to use another, and `HEARTH_DEPLOY_HOST` to pin the address.

On the server the script stops `hearth-and-ash` (every running village is saved first), copies `/var/lib/hearth` to
`/var/backups/hearth/<timestamp>`, swaps in the new `dist`, starts the service and waits for
`http://127.0.0.1:3100/api/health`. If the new release does not come up healthy it restores the previous `dist`,
libraries, service file and the pre-deploy data automatically, and the deploy reports failure. Players see the
connection banner for a few seconds. Libraries are reinstalled on the server only when `package-lock.json` changed.
`RELEASE` and `deployed.log` in `/opt/hearth-and-ash` record what is running (commit, `-dirty` if uncommitted changes).

Manual rollback to the previous release: on the server, `sudo systemctl stop hearth-and-ash`, swap `dist` and
`dist.prev` in `/opt/hearth-and-ash`, restore a backup from `/var/backups/hearth` if the data changed
(remove `/var/lib/hearth/hearth.db*`, then `sudo cp -a /var/backups/hearth/<timestamp>/. /var/lib/hearth/`), then start it.

## One-time setup (on the server, with sudo)

Needs Node.js 22 or newer (`node --version`) and `curl`. The old game uses port 3000: make sure nothing else uses 3100.

```bash
sudo useradd --system --home /opt/hearth-and-ash --shell /usr/sbin/nologin hearth
# The deploy user (ray) writes releases here; the service user reads them.
sudo install -d -o ray -g hearth -m 755 /opt/hearth-and-ash
```

The first `npm run deploy` does the rest: it installs the libraries, installs and enables `hearth-and-ash.service` and the
backup timer, and starts the service (the script recognises a first deploy by the missing `dist` folder, and on a first
deploy there is nothing to roll back to). The deploy user needs passwordless sudo for `systemctl`, `cp`, `install`,
`mkdir` and `rm`, as for the old game.

To install the service by hand instead:

```bash
sudo cp deploy/hearth-and-ash.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now hearth-and-ash
```

## Everyday commands

```bash
systemctl status hearth-and-ash        # is it running?
journalctl -u hearth-and-ash -f        # live log
sudo systemctl restart hearth-and-ash  # restart (running villages are saved first)
curl http://127.0.0.1:3100/api/health  # {"ok":true,"online":0,"running":0,...}
```

## Settings

Create `/etc/hearth-and-ash.env` (optional) with lines such as:

```
WORLD_SEED=1337
COOKIE_SECURE=1
TRUST_PROXY=1
AUTOSAVE_MS=30000
AWAY_CAP_HOURS=8
```

`DEV_MODE=1` switches on the dev tools (a DEV button in the game with a fast-forward of any number of game days, and an undo of the
last fast-forward). It is on by default outside production and off in production: a fast-forward really changes the village, so a
deployed server has to be told. The village as it was before the last fast-forward is kept in the `kv` table and put back by the undo.

`COOKIE_SECURE` and `TRUST_PROXY` are for when the game sits behind an HTTPS reverse proxy. `AWAY_CAP_HOURS` is a stub
until milestone M4 (away time); the server reads it and ignores it. Apply changes with a restart.

## How the village is kept

A village is simulated only while its owner is connected. The server writes a full, versioned snapshot of the village to
the database every 30 seconds while it runs, and on pause, disconnect and shutdown, so a restart (or a deploy) brings the
village back exactly as it was. Accounts and snapshots live in `/var/lib/hearth/hearth.db`, outside the program folder.

## Backups

Two kinds run on the same disk:

- **Nightly (04:00 server time):** the `hearth-backup` systemd timer takes a consistent snapshot while the game keeps
  running, checks it, and keeps the newest 14 in `/var/backups/hearth-nightly/` as `hearth-<UTC time>.db.gz`.
  Run one by hand with `sudo systemctl start hearth-backup`; see the schedule with `systemctl list-timers hearth-backup.timer`.
  `npm run deploy` installs and updates the timer.
- **Before every deploy:** a full copy of the data folder in `/var/backups/hearth/<timestamp>/` (newest 10 kept).

These protect against mistakes and bad deploys, not against the disk dying. Copy `/var/backups/hearth-nightly/` to
another machine now and then.

To restore a nightly backup: `sudo systemctl stop hearth-and-ash`, remove `/var/lib/hearth/hearth.db*`, run
`gunzip -c /var/backups/hearth-nightly/<file>.db.gz | sudo -u hearth tee /var/lib/hearth/hearth.db >/dev/null`, then start the service.
