import { useLayoutEffect, useRef, type RefObject } from 'react';
import { Euler, Matrix4, Quaternion } from 'three';
import type { Cube2DLayout } from '../presentation/cube/Cube2DLayout';
import { cubeOrientationAnchorToQuaternion, type Cube3DViewState } from '../presentation/cube/Cube3DViewState';
import { orientationAtVerticalAnchor } from '../presentation/cube/Cube2DNavigation';
import { CUBE_VIEW_TRANSITION_MS, cubeViewTransitionMotion, type CubeViewTransitionBridge } from '../renderer3d/CubeViewTransition';
import { cubeFoldEase, cubeNetFoldMatrix } from '../renderer3d/CubeNetFold';

interface Props {
  readonly transitionBridgeRef: RefObject<CubeViewTransitionBridge | null>;
  readonly gameRef: RefObject<HTMLElement | null>;
  readonly layout: Cube2DLayout;
  readonly viewState: Cube3DViewState;
  readonly direction: '2d' | '3d';
  readonly onComplete: () => void;
}

export function CubeViewFold({ transitionBridgeRef, gameRef, layout, viewState, direction, onComplete }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  useLayoutEffect(() => {
    const host = hostRef.current!;
    const game = gameRef.current!;
    const boards = [...game.querySelectorAll<HTMLElement>('.cube-2d-renderer .cube-2d-board')];
    const anchor = layout.verticalAnchorColumn;
    const anchorBoard = boards.find(board => board.dataset.layoutRow === '1' && Number(board.dataset.layoutColumn) === anchor)!;
    const bounds = anchorBoard.getBoundingClientRect();
    const side = bounds.width;
    const fade = document.createElement('div');
    Object.assign(fade.style, { position: 'absolute', inset: '0' });
    host.append(fade);
    const root = document.createElement('div');
    root.className = 'cube-2d-renderer cube-view-fold__root';
    root.dataset.cubeSize = String(layout.size);
    root.style.setProperty('--cube-2d-content-scale', getComputedStyle(anchorBoard).getPropertyValue('--cube-2d-content-scale'));
    Object.assign(root.style, { position: 'absolute', display: 'block', width: '0', height: '0', overflow: 'visible', isolation: 'auto', transformOrigin: '0 0' });
    root.style.visibility = 'hidden';
    fade.append(root);
    const faces = boards.map(board => {
      const face = board.cloneNode(true) as HTMLElement;
      face.className = 'cube-2d-board cube-view-fold__face';
      face.querySelectorAll('.cube-2d-board__hover, .cube-2d-board__hit-areas').forEach(node => node.remove());
      // Cloned SVG paint servers need unique IDs while the original net remains mounted.
      face.querySelectorAll('[id]').forEach(node => {
        const id = node.id;
        node.id = `fold-${id}`;
        face.querySelectorAll('[fill], [stroke], [filter]').forEach(painted => {
          for (const attr of ['fill', 'stroke', 'filter']) {
            const value = painted.getAttribute(attr);
            if (value?.includes(`#${id})`)) painted.setAttribute(attr, value.replace(`#${id})`, `#fold-${id})`));
          }
        });
      });
      Object.assign(face.style, { position: 'absolute', width: `${side}px`, height: `${side}px`, left: `${-side / 2}px`, top: `${-side / 2}px` });
      const back = document.createElement('div');
      back.className = 'cube-2d-board cube-view-fold__face';
      back.style.cssText = face.style.cssText;
      root.append(face, back);
      return { face, back, row: Number(board.dataset.layoutRow), column: Number(board.dataset.layoutColumn) };
    });
    const anchorOrientation = orientationAtVerticalAnchor(layout.orientation, anchor);
    const q = cubeOrientationAnchorToQuaternion(anchorOrientation.toState());
    const target = new Quaternion(viewState.rotation.x, viewState.rotation.y, viewState.rotation.z, viewState.rotation.w)
      .multiply(new Quaternion(q.x, q.y, q.z, q.w).invert());
    // Reflect world Y to match CSS's downward Y axis.
    target.set(-target.x, target.y, -target.z, target.w);
    let frameId = 0;
    let started: number | undefined;
    let lastFold = -1;
    const rotation = new Quaternion();
    const spin = new Quaternion();
    const spinEuler = new Euler();
    const worldRotation = new Quaternion();
    const anchorRotation = new Quaternion(q.x, q.y, q.z, q.w);
    const matrix = new Matrix4();
    const scratch = new Matrix4();
    const frame = (now: number) => {
      const scene = game.querySelector<HTMLElement>('.cube-3d-scene');
      if (!scene) {
        frameId = requestAnimationFrame(frame);
        return;
      }
      const ready = scene.dataset.cube3dReady === 'true' && transitionBridgeRef.current !== null;
      if (!ready) {
        frameId = requestAnimationFrame(frame);
        return;
      }
      started ??= now;
      const time = started === undefined ? 0 : Math.min(1, (now - started) / CUBE_VIEW_TRANSITION_MS);
      const progress = direction === '3d' ? time : 1 - time;
      const motion = cubeViewTransitionMotion(progress, direction);
      const travel = motion.travel;
      const rect = scene.getBoundingClientRect();
      scene.style.setProperty('--cube3d-backdrop', String(travel));
      const focal = rect.height / (2 * Math.tan(Math.PI / 8));
      const finalSide = focal * 2 * viewState.zoom / 5;
      const scale = 1 + (finalSide / side - 1) * motion.approach;
      const x = bounds.x + side / 2 + (rect.x + rect.width / 2 - bounds.x - side / 2) * travel;
      const y = bounds.y + side / 2 + (rect.y + rect.height / 2 - bounds.y - side / 2) * travel;
      fade.style.perspective = `${focal}px`;
      fade.style.perspectiveOrigin = `${x}px ${y}px`;
      rotation.identity().slerp(target, motion.turn);
      rotation.premultiply(spin.setFromEuler(spinEuler.set(motion.pitch, motion.yaw, 0)));
      const reveal = motion.blend;
      if (motion.blend < 1) {
        matrix.makeTranslation(x, y, 0)
          .multiply(scratch.makeRotationFromQuaternion(rotation))
          .multiply(scratch.makeScale(scale, scale, scale))
          .multiply(scratch.makeTranslation(0, 0, side * cubeFoldEase(motion.fold) / 2));
        root.style.transform = `matrix3d(${matrix.elements.join(',')})`;
      }
      // Once the hinges close, their local transforms and texture crop are constant.
      if (motion.fold !== lastFold && motion.blend < 1) {
        lastFold = motion.fold;
        for (const { face, back, row, column } of faces) {
          const transform = cubeNetFoldMatrix(row, column, anchor, motion.fold);
          transform.elements[12] *= side;
          transform.elements[13] *= side;
          transform.elements[14] *= side;

          // Crop out the baked black frame as the net becomes a continuous surface.
          const crop = 100 + 18 * cubeFoldEase(motion.fold);
          face.style.backgroundSize = back.style.backgroundSize = `${crop}%`;
          face.style.backgroundColor = back.style.backgroundColor = '#a66b37';
          face.style.transform = `matrix3d(${transform.elements.join(',')})`;
          back.style.transform = `${face.style.transform} rotateY(180deg)`;
        }
      }
      fade.style.opacity = String(1 - reveal);
      if (root.style.visibility !== 'visible') root.style.visibility = 'visible';
      game.dataset.foldReady = 'true';
      worldRotation.set(-rotation.x, rotation.y, -rotation.z, rotation.w).multiply(anchorRotation);
      transitionBridgeRef.current?.render({
        rotation: worldRotation,
        scale: scale * side / finalSide,
        offsetX: x - rect.x - rect.width / 2,
        offsetY: y - rect.y - rect.height / 2,
        opacity: reveal,
      });
      host.dataset.foldBlend = reveal.toFixed(3);
      host.dataset.foldYaw = motion.yaw.toFixed(6);
      host.dataset.foldProgress = progress.toFixed(3);
      if (time < 1) frameId = requestAnimationFrame(frame);
      else completeRef.current();
    };
    frameId = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(frameId);
      // The outgoing 3D renderer is disposed on 3D → 2D; do not draw an
      // expensive full-resolution frame just before unmounting it.
      if (direction === '3d') transitionBridgeRef.current?.reset();
      game.querySelector<HTMLElement>('.cube-3d-scene')?.style.removeProperty('--cube3d-backdrop');
      delete game.dataset.foldReady;
      fade.remove();
    };
  }, [direction, gameRef, layout, viewState, transitionBridgeRef]);
  return <div ref={hostRef} className="cube-view-fold" aria-hidden="true" data-fold-anchor={layout.verticalAnchorColumn} />;
}
