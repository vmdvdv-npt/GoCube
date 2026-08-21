import {
  CUBE_2D_LAYOUT_COLUMNS,
  type Cube2DLayoutColumn,
} from './Cube2DLayout';
import { CubeOrientation } from './CubeOrientation';

export type Cube2DNavigationDirection = 'left' | 'right' | 'up' | 'down';

export interface Cube2DViewState {
  readonly orientation: CubeOrientation;
  readonly verticalAnchorColumn: Cube2DLayoutColumn;
}

export const DEFAULT_CUBE_2D_VERTICAL_ANCHOR_COLUMN: Cube2DLayoutColumn = 1;

const isVerticalAnchorColumn = (column: number): column is Cube2DLayoutColumn =>
  Number.isInteger(column) && column >= 0 && column < CUBE_2D_LAYOUT_COLUMNS;

export const createCube2DViewState = (
  orientation: CubeOrientation = new CubeOrientation(),
  verticalAnchorColumn: Cube2DLayoutColumn = DEFAULT_CUBE_2D_VERTICAL_ANCHOR_COLUMN,
): Cube2DViewState => {
  if (!isVerticalAnchorColumn(verticalAnchorColumn)) {
    throw new Error(`Invalid Cube 2D vertical anchor column: ${verticalAnchorColumn}`);
  }

  return Object.freeze({ orientation, verticalAnchorColumn });
};

/** Pure presentation navigation. It changes only Cube 2D view state, never GameState. */
export const navigateCube2DViewState = (
  state: Cube2DViewState,
  direction: Cube2DNavigationDirection,
): Cube2DViewState => {
  let orientation: CubeOrientation;

  switch (direction) {
    case 'left':
      orientation = state.orientation.moveLeft();
      break;
    case 'right':
      orientation = state.orientation.moveRight();
      break;
    case 'up':
      orientation = state.orientation.moveUp();
      break;
    case 'down':
      orientation = state.orientation.moveDown();
      break;
  }

  return createCube2DViewState(orientation, state.verticalAnchorColumn);
};

/** Moves the physical TOP/BOTTOM pair together without changing cube orientation. */
export const setCube2DVerticalAnchorColumn = (
  state: Cube2DViewState,
  verticalAnchorColumn: number,
): Cube2DViewState => {
  if (!isVerticalAnchorColumn(verticalAnchorColumn)) {
    throw new Error(`Invalid Cube 2D vertical anchor column: ${verticalAnchorColumn}`);
  }

  if (state.verticalAnchorColumn === verticalAnchorColumn) return state;
  return createCube2DViewState(state.orientation, verticalAnchorColumn);
};
