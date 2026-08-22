import type { CubeSize } from '../core/topology/CubeTopology';

/** Sizes currently exposed by the product UI. CubeTopology itself is not limited to these. */
export const CUBE_UI_SIZES = [2, 3, 4, 5, 6, 7] as const satisfies readonly CubeSize[];
export type CubeUiSize = (typeof CUBE_UI_SIZES)[number];

export const isCubeUiSize = (value: unknown): value is CubeUiSize =>
  typeof value === 'number' && CUBE_UI_SIZES.some((size) => size === value);
