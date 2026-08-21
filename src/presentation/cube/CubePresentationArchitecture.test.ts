import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MODEL_FILES = [
  'src/presentation/cube/CubeOrientation.ts',
  'src/presentation/cube/Cube2DLayout.ts',
] as const;

describe('Cube orientation/layout architecture boundary', () => {
  it.each(MODEL_FILES)('%s has no renderer, browser, GameState, or GameEngine dependency', (path: (typeof MODEL_FILES)[number]) => {
    const source = readFileSync(resolve(process.cwd(), path), 'utf8');

    expect(source).not.toMatch(/from\s+['"]react(?:\/[^'"]*)?['"]/i);
    expect(source).not.toMatch(/from\s+['"].*(?:renderer|svg|three).*['"]/i);
    expect(source).not.toMatch(/\b(?:document|window|HTMLElement|SVGElement|CanvasRenderingContext2D)\b/);
    expect(source).not.toMatch(/\b(?:GameState|GameEngine|GameSession)\b/);
    expect(source).not.toMatch(/\b(?:clientX|clientY|screenX|screenY|offsetX|offsetY)\b/);
  });
});
