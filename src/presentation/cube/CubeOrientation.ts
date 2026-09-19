import type { CubeFace } from '../../core/topology/CubeTopology';
import {
  crossCubeAxisVectors,
  cubeFaceBasis,
  cubeFaceFromNormal,
  dotCubeAxisVectors,
  negateCubeAxisVector,
  oppositeCubeFace,
} from './CubeSurfaceMapping';

/** Clockwise quarter-turn from the canonical logical orientation of a CubeTopology face. */
export type CubeRotation = 0 | 90 | 180 | 270;

export interface CubeOrientationState {
  readonly centerFace: CubeFace;
  readonly upFace: CubeFace;
}

export interface CubeOrientationNeighbors {
  readonly left: CubeFace;
  readonly right: CubeFace;
  readonly top: CubeFace;
  readonly bottom: CubeFace;
}

export { oppositeCubeFace } from './CubeSurfaceMapping';

/** Pure view-orientation state: one central logical face plus the adjacent face treated as up. */
export class CubeOrientation {
  readonly centerFace: CubeFace;
  readonly upFace: CubeFace;

  constructor(state: CubeOrientationState = { centerFace: 'front', upFace: 'top' }) {
    const centerNormal = cubeFaceBasis(state.centerFace).normal;
    const upNormal = cubeFaceBasis(state.upFace).normal;

    if (dotCubeAxisVectors(centerNormal, upNormal) !== 0) {
      throw new Error(
        `Invalid cube orientation: ${state.upFace} cannot be up while ${state.centerFace} is central`,
      );
    }

    this.centerFace = state.centerFace;
    this.upFace = state.upFace;
  }

  get neighbors(): CubeOrientationNeighbors {
    const right = this.rightFace();
    return Object.freeze({
      left: oppositeCubeFace(right),
      right,
      top: this.upFace,
      bottom: oppositeCubeFace(this.upFace),
    });
  }

  get rotation(): CubeRotation {
    const basis = cubeFaceBasis(this.centerFace);
    const canonicalTop = cubeFaceFromNormal(negateCubeAxisVector(basis.down));
    const canonicalRight = cubeFaceFromNormal(basis.right);
    const canonicalBottom = oppositeCubeFace(canonicalTop);
    const canonicalLeft = oppositeCubeFace(canonicalRight);

    if (this.upFace === canonicalTop) return 0;
    if (this.upFace === canonicalLeft) return 90;
    if (this.upFace === canonicalBottom) return 180;
    if (this.upFace === canonicalRight) return 270;

    throw new Error(`Cannot resolve rotation for ${this.centerFace} with up ${this.upFace}`);
  }

  moveLeft(): CubeOrientation {
    return new CubeOrientation({ centerFace: this.neighbors.left, upFace: this.upFace });
  }

  moveRight(): CubeOrientation {
    return new CubeOrientation({ centerFace: this.neighbors.right, upFace: this.upFace });
  }

  moveUp(): CubeOrientation {
    return new CubeOrientation({
      centerFace: this.upFace,
      upFace: oppositeCubeFace(this.centerFace),
    });
  }

  moveDown(): CubeOrientation {
    return new CubeOrientation({
      centerFace: oppositeCubeFace(this.upFace),
      upFace: this.centerFace,
    });
  }

  equals(other: CubeOrientation): boolean {
    return this.centerFace === other.centerFace && this.upFace === other.upFace;
  }

  toState(): CubeOrientationState {
    return Object.freeze({ centerFace: this.centerFace, upFace: this.upFace });
  }

  private rightFace(): CubeFace {
    return cubeFaceFromNormal(
      crossCubeAxisVectors(
        cubeFaceBasis(this.upFace).normal,
        cubeFaceBasis(this.centerFace).normal,
      ),
    );
  }
}
