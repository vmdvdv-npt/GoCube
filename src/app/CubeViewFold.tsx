import { useLayoutEffect, useRef, type RefObject } from 'react';
import { Euler, Matrix4, Quaternion } from 'three';
import type { Cube2DLayout } from '../presentation/cube/Cube2DLayout';
import { cubeOrientationAnchorToQuaternion, type Cube3DViewState } from '../presentation/cube/Cube3DViewState';
import { cubeFoldEase, cubeNetFoldMatrix } from '../renderer3d/CubeNetFold';

interface Props {
  readonly gameRef: RefObject<HTMLElement | null>;
  readonly layout: Cube2DLayout;
  readonly viewState: Cube3DViewState;
  readonly direction: '2d' | '3d';
  readonly onComplete: () => void;
}

export function CubeViewFold({ gameRef, layout, viewState, direction, onComplete }: Props) {
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
    const root = document.createElement('div');
    root.className = 'cube-2d-renderer cube-view-fold__root';
    root.dataset.cubeSize = String(layout.size);
    root.style.setProperty('--cube-2d-content-scale', getComputedStyle(anchorBoard).getPropertyValue('--cube-2d-content-scale'));
    Object.assign(root.style, { position: 'absolute', display: 'block', width: '0', height: '0', overflow: 'visible', isolation: 'auto', transformOrigin: '0 0' });
    root.style.visibility = 'hidden';
    host.append(root);
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
    let anchorOrientation = layout.orientation;
    for (let i = 1; i < anchor; i++) anchorOrientation = anchorOrientation.moveRight();
    if (anchor === 0) anchorOrientation = anchorOrientation.moveLeft();
    const q = cubeOrientationAnchorToQuaternion(anchorOrientation.toState());
    const target = new Quaternion(viewState.rotation.x, viewState.rotation.y, viewState.rotation.z, viewState.rotation.w)
      .multiply(new Quaternion(q.x, q.y, q.z, q.w).invert());
    // Reflect world Y to match CSS's downward Y axis.
    target.set(-target.x, target.y, -target.z, target.w);
    let frameId = 0;
    let started: number | undefined;
    const frame = (now: number) => {
      const scene = game.querySelector<HTMLElement>('.cube-3d-scene');
      if (!scene) {
        frameId = requestAnimationFrame(frame);
        return;
      }
      const ready = scene.dataset.cube3dReady === 'true';
      if (ready) started ??= now;
      const time = started === undefined ? 0 : Math.min(1, (now - started) / 580);
      const progress = direction === '3d' ? time : 1 - time;
      const travel = cubeFoldEase(progress);
      const rect = scene.getBoundingClientRect();
      const focal = rect.height / (2 * Math.tan(Math.PI / 8));
      const finalSide = focal * 2 * viewState.zoom / 5;
      const scale = 1 + (finalSide / side - 1) * cubeFoldEase((progress - 0.3) / 0.7);
      const x = bounds.x + side / 2 + (rect.x + rect.width / 2 - bounds.x - side / 2) * travel;
      const y = bounds.y + side / 2 + (rect.y + rect.height / 2 - bounds.y - side / 2) * travel;
      host.style.perspective = `${focal}px`;
      host.style.perspectiveOrigin = `${x}px ${y}px`;
      const rotation = new Quaternion().slerp(target, cubeFoldEase((progress - 0.4) / 0.45));
      const lift = Math.sin(Math.PI * progress);
      rotation.multiply(new Quaternion().setFromEuler(new Euler(-0.12 * lift, 0.16 * lift, 0)));
      const reveal = cubeFoldEase((progress - 0.88) / 0.12);
      const matrix = new Matrix4().makeTranslation(x, y, 0)
        .multiply(new Matrix4().makeRotationFromQuaternion(rotation))
        .multiply(new Matrix4().makeScale(scale, scale, scale))
        .multiply(new Matrix4().makeTranslation(0, 0, side * cubeFoldEase(progress / 0.65) / 2));
      root.style.transform = `matrix3d(${matrix.elements.join(',')})`;
      for (const { face, back, row, column } of faces) {
        const transform = cubeNetFoldMatrix(row, column, anchor, Math.min(1, progress / 0.65));
        transform.elements[12] *= side;
        transform.elements[13] *= side;
        transform.elements[14] *= side;
        face.style.opacity = back.style.opacity = String(1 - reveal);
        face.style.transform = `matrix3d(${transform.elements.join(',')})`;
        back.style.transform = `${face.style.transform} rotateY(180deg)`;
      }
      root.style.visibility = 'visible';
      game.dataset.foldReady = 'true';
      scene.style.opacity = String(reveal);
      host.dataset.foldProgress = progress.toFixed(3);
      if (time < 1) frameId = requestAnimationFrame(frame);
      else completeRef.current();
    };
    frameId = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(frameId);
      game.querySelector<HTMLElement>('.cube-3d-scene')?.style.removeProperty('opacity');
      delete game.dataset.foldReady;
      root.remove();
    };
  }, [direction, gameRef, layout, viewState]);
  return <div ref={hostRef} className="cube-view-fold" aria-hidden="true" data-fold-anchor={layout.verticalAnchorColumn} />;
}
