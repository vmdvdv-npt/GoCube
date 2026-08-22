import { useEffect, useRef } from 'react';
import type { GroupStatus } from '../core/endgame/EndgameClassifier';
import {
  TorusGame as TorusGameBase,
  type TorusGameProps,
} from './TorusGameBase';

export type { TorusGameProps } from './TorusGameBase';

const statusFromButton = (button: HTMLButtonElement): GroupStatus | null => {
  const label = button.textContent?.trim().toLowerCase();
  if (label === 'alive') return 'alive';
  if (label === 'dead') return 'dead';
  if (label === 'seki') return 'seki';
  return null;
};

const nextFrame = (view: Window): Promise<void> =>
  new Promise((resolve) => view.requestAnimationFrame(() => resolve()));

/**
 * Compatibility adapter while the legacy Torus React screen still owns its local
 * presentation copy of manual review choices. GameSession remains authoritative:
 * every status click is autosaved through TorusGameController, and a restored
 * session replays its saved review choices into the presentation on mount.
 */
export function TorusGame({ controller, onRequestNewGame }: TorusGameProps) {
  const selectedGroupIdRef = useRef<string | null>(null);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.torus-game');
    const board = root?.querySelector<SVGSVGElement>('.torus-board');
    if (!root || !board) return;

    let cancelled = false;

    const trackSelectedGroup = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest('.torus-board')) return;

      const directGroupId = target
        .closest('[data-endgame-group-id]')
        ?.getAttribute('data-endgame-group-id');
      if (directGroupId) {
        selectedGroupIdRef.current = directGroupId;
        return;
      }

      const pointId = target
        .closest('[data-logical-point-id]')
        ?.getAttribute('data-logical-point-id');
      if (!pointId) return;

      const group = controller
        .endgameGroups()
        .find((candidate) => candidate.points.includes(pointId));
      if (group) selectedGroupIdRef.current = group.id;
    };

    const persistStatusClick = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement)) return;
      if (!target.closest('.endgame-statuses')) return;

      const status = statusFromButton(target);
      if (!status) return;

      const temporaryLine = board.querySelector<SVGElement>(
        '.torus-board__endgame-line[data-endgame-temporary="true"]',
      );
      const groupId =
        selectedGroupIdRef.current ??
        temporaryLine?.getAttribute('data-endgame-group-id') ??
        null;
      if (!groupId) return;

      void controller.setEndgameDecision(groupId, status);
    };

    root.addEventListener('click', trackSelectedGroup, true);
    root.addEventListener('click', persistStatusClick, true);

    const restoreReview = async (): Promise<void> => {
      const saved = controller.endgameDecisions();
      const entries = Object.entries(saved) as [string, GroupStatus][];
      if (entries.length === 0) return;

      const view = board.ownerDocument.defaultView;
      if (!view) return;
      await nextFrame(view);

      for (const [groupId, status] of entries) {
        if (cancelled) return;
        const group = controller.endgameGroups().find((candidate) => candidate.id === groupId);
        const point = group?.points[0];
        if (!point) continue;

        const stone = Array.from(
          board.querySelectorAll<SVGGraphicsElement>(
            '[data-logical-point-id][data-copy-role="primary"]',
          ),
        ).find((candidate) => candidate.getAttribute('data-logical-point-id') === point);
        if (!stone) continue;

        const bounds = stone.getBoundingClientRect();
        stone.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            clientX: bounds.left + bounds.width / 2,
            clientY: bounds.top + bounds.height / 2,
          }),
        );
        await nextFrame(view);
        if (cancelled) return;

        const button = Array.from(
          root.querySelectorAll<HTMLButtonElement>('.endgame-statuses button'),
        ).find((candidate) => statusFromButton(candidate) === status);
        button?.click();
        await nextFrame(view);
      }
    };

    void restoreReview();

    return () => {
      cancelled = true;
      selectedGroupIdRef.current = null;
      root.removeEventListener('click', trackSelectedGroup, true);
      root.removeEventListener('click', persistStatusClick, true);
    };
  }, [controller]);

  return <TorusGameBase controller={controller} onRequestNewGame={onRequestNewGame} />;
}
