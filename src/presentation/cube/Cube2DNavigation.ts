import { CubeOrientation } from './CubeOrientation';

export type Cube2DNavigationDirection = 'left' | 'right' | 'up' | 'down';

export interface Cube2DViewState {
  readonly orientation: CubeOrientation;
}

export const createCube2DViewState = (
  orientation: CubeOrientation = new CubeOrientation(),
): Cube2DViewState => Object.freeze({ orientation });

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

  return createCube2DViewState(orientation);
};
