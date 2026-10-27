/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync(path.join(__dirname, '../../styles/hud.css'), 'utf8');

/** The declarations of the first rule for a selector. */
function rule(selector: string): string {
  const i = css.indexOf(`${selector} {`);
  expect(i, selector).toBeGreaterThanOrEqual(0);
  return css.slice(i, css.indexOf('}', i));
}

describe('cards in the HUD layer', () => {
  it('take clicks themselves: the layer they sit in lets everything through to the map', () => {
    expect(rule('.hud-layers')).toContain('pointer-events: none');
    // a card that forgets this cannot be clicked (the first-run hints once could not)
    expect(rule('.hint')).toContain('pointer-events: auto');
    expect(rule('.offer')).toContain('pointer-events: auto');
  });
});
