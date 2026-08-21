import type { CubeFace } from '../../core/topology/CubeTopology';

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

type Axis = -1 | 0 | 1;
type AxisVector = readonly [Axis, Axis, Axis];

const FACE_NORMALS: Readonly<Record<CubeFace, AxisVector>> = Object.freeze({
  front: Object.freeze([0, 0, 1] as const),
  back: Object.freeze([0, 0, -1] as const),
  left: Object.freeze([-1, 0, 0] as const),
  right: Object.freeze([1, 0, 0] as const),
  top: Object.freeze([0, 1, 0] as const),
  bottom: Object.freeze([0, -1, 0] as const),
});

const CANONICAL_TOP: Readonly<Record<CubeFace, CubeFace>> = Object.freeze({
  front: 'top',
  back: 'top',
  left: 'top',
  right: 'top',
  top: 'back',
  bottom: 'front',
});

const CANONICAL_RIGHT: Readonly<Record<CubeFace, CubeFace>> = Object.freeze({
  front: 'right',
  back: 'left',
  left: 'front',
  right: 'back',
  top: 'right',
  bottom: 'right',
});

const negate = ([x, y, z]: AxisVector): AxisVector => [-x as Axis, -y as Axis, -z as Axis];

const cross = ([ax, ay, az]: AxisVector, [bx, by, bz]: AxisVector): AxisVector => [
  (ay * bz - az * by) as Axis,
  (az * bx - ax * bz) as Axis,
  (ax * by - ay * bx) as Axis,
];

const dot = ([ax, ay, az]: AxisVector, [bx, by, bz]: AxisVector): number =>
  ax * bx + ay * by + az * bz;

const faceFromNormal = (normal: AxisVector): CubeFace => {
  for (const [face, candidate] of Object.entries(FACE_NORMALS) as readonly [CubeFace, AxisVector][]) {
    if (candidate[0] === normal[0] && candidate[1] === normal[1] && candidate[2] === normal[2]) {
      return face;
    }
  }

  throw new Error(`Invalid cube axis vector: ${normal.join(',')}`);
};

export const oppositeCubeFace = (face: CubeFace): CubeFace =>
  faceFromNormal(negate(FACE_NORMALS[face]));

/** Pure view-orientation state: one central logical face plus the adjacent face treated as up. */
export class CubeOrientation {
  readonly centerFace: CubeFace;
  readonly upFace: CubeFace;

  constructor(state: CubeOrientationState = { centerFace: 'front', upFace: 'top' }) {
    const centerNormal = FACE_NORMALS[state.centerFace];
    const upNormal = FACE_NORMALS[state.upFace];

    if (dot(centerNormal, upNormal) !== 0) {
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
    const canonicalTop = CANONICAL_TOP[this.centerFace];
    const canonicalRight = CANONICAL_RIGHT[this.centerFace];
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
    return faceFromNormal(cross(FACE_NORMALS[this.upFace], FACE_NORMALS[this.centerFace]));
  }
}
