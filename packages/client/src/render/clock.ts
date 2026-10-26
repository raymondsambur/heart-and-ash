/**
 * Client-side extrapolation of the game clock between server TimeView updates. Pure (unit tested).
 * It runs on the sim clock (see `SimClock`): it stops while the village is paused and runs 2x or 4x faster accordingly.
 */
import type { TimeView, WeatherKind } from '@hearth/shared';

/**
 * A clock that moves at the time-control speed: 0 while paused, 1, 2 or 4 times real time otherwise.
 * People's steps and the day-night cycle both run on it, so everything the sim drives stays in step with it.
 */
export class SimClock {
  /** Milliseconds of game time shown so far (a local count; only differences matter). */
  now = 0;
  speed = 1;

  /** Advance by `dtReal` real milliseconds. */
  tick(dtReal: number): void {
    this.now += dtReal * this.speed;
  }
}

export class WorldClock {
  hours0 = 6;
  /** Sim-clock time at which `hours0` was received. */
  recvAt = 0;
  hourMs = 15000;
  day = 0;
  year = 0;
  season = 0;
  weather: WeatherKind = 'clear';
  /** Previous weather, for cross-fades. */
  prevWeather: WeatherKind = 'clear';
  weatherChangedAt = -1e9;

  /** `simNow` is the sim clock, `realNow` the real one (the weather cross-fade runs in real time). */
  set(tv: TimeView, simNow: number, realNow: number): void {
    this.hours0 = tv.hours;
    this.recvAt = simNow;
    this.hourMs = tv.hourMs > 0 ? tv.hourMs : 15000;
    this.day = tv.day;
    this.year = tv.year;
    this.season = ((tv.season % 4) + 4) % 4;
    if (tv.weather !== this.weather) {
      this.prevWeather = this.weather;
      this.weather = tv.weather;
      this.weatherChangedAt = realNow;
    }
  }

  /** Current time of day (0..24) extrapolated to the sim-clock time `simNow`. */
  hours(simNow: number): number {
    const h = this.hours0 + (simNow - this.recvAt) / this.hourMs;
    return ((h % 24) + 24) % 24;
  }

  /** 0..1 fade-in of the current weather since the last change (about 6 seconds of real time). */
  weatherBlend(now: number): number {
    const t = (now - this.weatherChangedAt) / 6000;
    return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
  }
}
