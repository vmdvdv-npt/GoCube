import { CubeOrientation } from './CubeOrientation';
import {
  createCube3DViewState,
  cubeQuaternionToOrientationAnchor,
  withCube3DOrientationAnchor,
  type Cube3DViewState,
} from './Cube3DViewState';

export type Cube3DNavigationDirection = 'left' | 'right' | 'up' | 'down';

export const CUBE_3D_STANDARD_ZOOM = 1;
export const CUBE_3D_STANDARD_ORIENTATION = Object.freeze({
  centerFace: 'front' as const,
  upFace: 'top' as const,
});

const movedOrientation = (
  orientation: CubeOrientation,
  direction: Cube3DNavigationDirection,
): CubeOrientation => {
  switch (direction) {
    case 'left':
      return orientation.moveLeft();
    case 'right':
      return orientation.moveRight();
    case 'up':
      return orientation.moveUp();
    case 'down':
      return orientation.moveDown();
  }
};

/**
 * Resolves a screen-direction command from the current arbitrary quaternion and returns
 * the exact canonical pose for the selected neighboring logical face.
 */
export const cube3DNavigationTarget = (
  state: Cube3DViewState,
  direction: Cube3DNavigationDirection,
): Cube3DViewState => {
  const currentAnchor = cubeQuaternionToOrientationAnchor(state.rotation);
  const targetOrientation = movedOrientation(new CubeOrientation(currentAnchor), direction);
  return withCube3DOrientationAnchor(state, targetOrientation.toState());
};

/** Exact standard pose used by the explicit Reset View command. */
export const cube3DResetTarget = (): Cube3DViewState =>
  createCube3DViewState({
    orientationAnchor: CUBE_3D_STANDARD_ORIENTATION,
    zoom: CUBE_3D_STANDARD_ZOOM,
  });
