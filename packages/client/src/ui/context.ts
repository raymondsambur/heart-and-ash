/**
 * `UiContext` (`ui`) is what every HUD part receives:
 *   ui.state      central Store (get/subscribe)
 *   ui.session    ask the server for something (speed)
 *   ui.gameView   the world renderer (centerOn, setZoom...)
 *   ui.settings   player-local settings
 *   ui.toast      feedback toasts
 */
import type { Look, NoteLevel } from '@hearth/shared';
import type { GameViewApi } from '../render/api';
import type { GameSession } from '../state/session';
import type { Store } from '../state/store';
import type { SettingsStore } from './settings';

export interface UiContext {
  state: Store;
  session: Pick<GameSession, 'setSpeed' | 'select' | 'setFollow' | 'build' | 'demolish' | 'cancelOrder' | 'setRation' | 'setPriority' | 'saveRule' | 'deleteRule' | 'answer' | 'markRead'>;
  /** Draw a person's portrait into a small canvas. */
  portrait(canvas: HTMLCanvasElement, look: Look): void;
  gameView: GameViewApi;
  settings: SettingsStore;
  toast(text: string, level?: NoteLevel): void;
  /** Reload the page (a new client version is available). */
  reload(): void;
  logout(): void;
  /** The session ended (expired or signed out elsewhere): back to the sign-in screen with a message. */
  reauth(notice?: string): void;
}
