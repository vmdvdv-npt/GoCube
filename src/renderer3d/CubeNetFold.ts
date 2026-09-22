import { Matrix4 } from 'three';

const smooth = (value: number): number => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
export const cubeFoldEase = smooth;

/** Face-centred transforms in CSS coordinates (x right, y down, z toward viewer).
 * Every hinge inherits its parent's transform, so even an end-column cross closes
 * without detaching the far end of the four-face belt.
 */
export function cubeNetFoldMatrix(row: number, column: number, anchor: number, progress: number): Matrix4 {
  const result = new Matrix4();
  const dx = column - anchor;
  const dy = row - 1;
  const count = Math.abs(dx) || Math.abs(dy);
  const sign = Math.sign(dx || dy);
  for (let depth = 0; depth < count; depth++) {
    const angle = smooth((progress - depth * 0.12) / 0.76) * Math.PI / 2;
    const x = dx ? sign : 0;
    const y = dy ? sign : 0;
    result.multiply(new Matrix4().makeTranslation(x / 2, y / 2, 0));
    result.multiply(dx
      ? new Matrix4().makeRotationY(sign * angle)
      : new Matrix4().makeRotationX(-sign * angle));
    result.multiply(new Matrix4().makeTranslation(x / 2, y / 2, 0));
  }
  return result;
}
