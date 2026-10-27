/**
 * Game screen: the full-viewport village canvas under the HUD (village card, clock, time controls, connection
 * feedback). Owns the live GameSession.
 */
import { t } from '../../i18n';
import { api } from '../../net/api';
import type { GameSocket } from '../../net/socket';
import type { DecodedWorld, RenderModule } from '../../render/api';
import { GameSession } from '../../state/session';
import type { Store } from '../../state/store';
import type { UiContext } from '../context';
import { h } from '../dom';
import { mountBuild } from '../hud/build';
import { structureAt } from '../hud/buildLogic';
import { mountClock } from '../hud/clock';
import { mountConnection } from '../hud/connection';
import { mountFeed } from '../hud/feed';
import { mountManage } from '../hud/manage';
import { mountPeople } from '../hud/people';
import { mountSheet } from '../hud/sheet';
import { mountTimeControls } from '../hud/timeControls';
import { mountVillageCard } from '../hud/villageCard';
import type { SettingsStore } from '../settings';
import { toast } from '../widgets/toast';
import type { Screen } from './screen';

export interface GameScreenOptions {
  store: Store;
  settings: SettingsStore;
  render: RenderModule;
  world: DecodedWorld;
  socket: GameSocket;
  onLogout(): void;
  onReauth(notice?: string): void;
}

export interface GameScreen extends Screen {
  ui: UiContext;
  session: GameSession;
  /** Call once the element is in the document: sizes the canvas, loads the world and opens the socket. */
  start(): void;
}

export function createGameScreen(o: GameScreenOptions): GameScreen {
  const { store, settings, render, world, socket } = o;

  // ---- DOM skeleton ---------------------------------------------------------------------------
  const canvas = h('canvas', { class: 'game-canvas', tabindex: '-1', 'aria-label': t('game.canvas') });
  const hudTL = h('div', { class: 'hud-tl' });
  const hudTR = h('div', { class: 'hud-tr' });
  const hudBC = h('div', { class: 'hud-bc' });
  const hudBL = h('div', { class: 'hud-bl' });
  const hudBR = h('div', { class: 'hud-br' });
  const hudLayers = h('div', { class: 'hud-layers' });
  const hud = h('div', { class: 'hud' }, hudTL, hudTR, hudBC, hudBL, hudBR, hudLayers);
  const root = h('div', { class: 'game' }, canvas, hud);

  // ---- renderer -----------------------------------------------------------------------------------
  const gameView = render.createGameView(canvas);
  const fit = () => gameView.resize();
  const ro = new ResizeObserver(fit);
  ro.observe(root);
  window.addEventListener('orientationchange', fit);
  // Safari fires gesture events for pinch; the canvas handles zoom itself.
  const noGesture = (e: Event) => e.preventDefault();
  canvas.addEventListener('gesturestart', noGesture);
  canvas.addEventListener('gesturechange', noGesture);

  // ---- session + context -------------------------------------------------------------------------------
  const session = new GameSession({
    store,
    socket,
    view: gameView,
    hooks: {
      note: (level, text) => toast(text, level),
      error: (_code, text) => toast(text, 'bad'),
    },
    onNotConnected: () => toast(t('err.notConnected'), 'warn'),
  });

  const ui: UiContext = {
    state: store,
    session,
    gameView,
    portrait: (cv, look) => render.drawLookPreview(cv, look, { scale: 3, backdrop: false }),
    settings,
    toast: (text, level = 'info') => toast(text, level),
    reload: () => location.reload(),
    logout: o.onLogout,
    reauth: (notice) => o.onReauth(notice),
  };

  // ---- HUD ---------------------------------------------------------------------------------------------------
  const managePanel = mountManage(hudBR, hudLayers, ui);
  const buildPanel = mountBuild(hudBR, ui, world);
  const parts = [managePanel, mountVillageCard(hudTL, ui), mountPeople(hudTL, ui), mountClock(hudTR, ui), mountSheet(hudTR, ui), mountTimeControls(hudBC, ui), mountFeed(hudBL, ui), buildPanel, mountConnection(hudLayers, ui, socket)];

  // With a build tool in hand the pointer lays out footprints. Otherwise a tap selects a person, or a building to read its
  // progress; tapping bare ground lets go.
  gameView.onPick((pick, gesture) => {
    if (buildPanel.handlePick(pick, gesture)) return;
    if (gesture !== 'tap') return;
    const f = pick.entityId === null ? structureAt(store.get('buildings'), store.get('plots'), pick.x, pick.y) : null;
    store.set('focus', f);
    session.select(pick.entityId);
  });

  // A rejected WebSocket upgrade looks like a plain network failure (the server answers 401 before upgrading).
  // While reconnecting, ask the HTTP API whether the session is still valid and fall back to sign-in if it is not.
  let lastChecked = -1;
  const unsubConn = store.subscribe('conn', () => {
    const c = store.get('conn');
    if (c.state !== 'reconnecting' || c.attempt < 2 || c.attempt === lastChecked || (c.attempt & (c.attempt - 1)) !== 0) return;
    lastChecked = c.attempt;
    void api
      .me()
      .then((me) => {
        if (!me) o.onReauth(t('err.sessionExpired'));
      })
      .catch(() => undefined);
  });

  return {
    el: root,
    ui,
    session,
    start() {
      document.body.classList.add('has-hud');
      gameView.resize();
      gameView.loadWorld(world);
      gameView.start();
      session.start();
    },
    destroy() {
      document.body.classList.remove('has-hud');
      unsubConn();
      for (const p of parts) p.destroy();
      session.stop();
      gameView.stop();
      ro.disconnect();
      window.removeEventListener('orientationchange', fit);
      root.remove();
    },
  };
}
