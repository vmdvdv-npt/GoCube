import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const easeOutCubic = (progress: number): number => 1 - (1 - progress) ** 3;

export interface Shared3DStonePlacementAnimationOptions {
  readonly stones: THREE.InstancedMesh;
  readonly instanceIndex: number;
  readonly finalMatrix: THREE.Matrix4;
  readonly pitch: number;
  readonly requestRender: () => void;
}

/** Shared short, non-blocking Cube/Torus stone placement animation. */
export const animateShared3DStonePlacement = (
  options: Shared3DStonePlacementAnimationOptions,
): (() => void) => {
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  options.finalMatrix.decompose(position, rotation, scale);
  const normal = UP.clone().applyQuaternion(rotation).normalize();
  const started = performance.now();
  let frameId = 0;

  const frame = (now: number): void => {
    const progress = Math.min(1, Math.max(0, (now - started) / 180));
    const eased = easeOutCubic(progress);
    const matrix = new THREE.Matrix4().compose(
      position.clone().addScaledVector(normal, (1 - eased) * options.pitch * 0.22),
      rotation,
      scale.clone().multiplyScalar(0.75 + eased * 0.25),
    );
    options.stones.setMatrixAt(options.instanceIndex, matrix);
    options.stones.instanceMatrix.needsUpdate = true;
    options.requestRender();
    if (progress < 1) frameId = window.requestAnimationFrame(frame);
  };

  frameId = window.requestAnimationFrame(frame);
  return () => {
    window.cancelAnimationFrame(frameId);
    options.stones.setMatrixAt(options.instanceIndex, options.finalMatrix);
    options.stones.instanceMatrix.needsUpdate = true;
    options.requestRender();
  };
};
