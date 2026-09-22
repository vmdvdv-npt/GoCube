export interface EndgameContourCell {
  readonly column: number;
  readonly row: number;
}

export interface EndgameContourLattice {
  readonly originX: number;
  readonly originY: number;
  readonly spacing: number;
}

type GridPoint = Readonly<{ x: number; y: number }>;
type DisplayPoint = Readonly<{ x: number; y: number }>;
type Direction = 0 | 1 | 2 | 3;

type BoundaryEdge = Readonly<{
  from: GridPoint;
  to: GridPoint;
  direction: Direction;
  key: string;
}>;

type RoundedCorner = Readonly<{
  entry: DisplayPoint;
  exit: DisplayPoint;
  sweep: 0 | 1;
}>;

const cellKey = (column: number, row: number): string => `${column},${row}`;
const pointKey = (point: GridPoint): string => `${point.x},${point.y}`;

const boundaryEdge = (
  from: GridPoint,
  to: GridPoint,
  direction: Direction,
): BoundaryEdge =>
  Object.freeze({
    from,
    to,
    direction,
    key: `${pointKey(from)}>${pointKey(to)}`,
  });

const boundaryEdges = (cells: readonly EndgameContourCell[]): readonly BoundaryEdge[] => {
  const uniqueCells = new Map<string, EndgameContourCell>();
  for (const cell of cells) {
    if (!Number.isInteger(cell.column) || !Number.isInteger(cell.row)) {
      throw new Error('Endgame contour cells must use integer grid coordinates');
    }
    uniqueCells.set(cellKey(cell.column, cell.row), cell);
  }

  const occupied = new Set(uniqueCells.keys());
  const edges: BoundaryEdge[] = [];

  for (const cell of uniqueCells.values()) {
    const left = cell.column * 2 - 1;
    const right = cell.column * 2 + 1;
    const top = cell.row * 2 - 1;
    const bottom = cell.row * 2 + 1;

    if (!occupied.has(cellKey(cell.column, cell.row - 1))) {
      edges.push(boundaryEdge({ x: left, y: top }, { x: right, y: top }, 0));
    }
    if (!occupied.has(cellKey(cell.column + 1, cell.row))) {
      edges.push(boundaryEdge({ x: right, y: top }, { x: right, y: bottom }, 1));
    }
    if (!occupied.has(cellKey(cell.column, cell.row + 1))) {
      edges.push(boundaryEdge({ x: right, y: bottom }, { x: left, y: bottom }, 2));
    }
    if (!occupied.has(cellKey(cell.column - 1, cell.row))) {
      edges.push(boundaryEdge({ x: left, y: bottom }, { x: left, y: top }, 3));
    }
  }

  return Object.freeze(
    edges.sort(
      (left, right) =>
        left.from.y - right.from.y ||
        left.from.x - right.from.x ||
        left.direction - right.direction,
    ),
  );
};

const nextDirectionPriority = (incoming: Direction): readonly Direction[] =>
  Object.freeze([
    ((incoming + 1) % 4) as Direction,
    incoming,
    ((incoming + 3) % 4) as Direction,
    ((incoming + 2) % 4) as Direction,
  ]);

const simplifyLoop = (loop: readonly GridPoint[]): readonly GridPoint[] => {
  let current = [...loop];
  let changed = true;

  while (changed && current.length > 4) {
    changed = false;
    const next = current.filter((point, index) => {
      const previous = current[(index + current.length - 1) % current.length]!;
      const following = current[(index + 1) % current.length]!;
      const collinear =
        (previous.x === point.x && point.x === following.x) ||
        (previous.y === point.y && point.y === following.y);
      if (collinear) changed = true;
      return !collinear;
    });
    if (next.length < 4) break;
    current = next;
  }

  return Object.freeze(current.map((point) => Object.freeze({ ...point })));
};

const traceBoundaryLoops = (edges: readonly BoundaryEdge[]): readonly (readonly GridPoint[])[] => {
  const outgoing = new Map<string, BoundaryEdge[]>();
  for (const edge of edges) {
    const key = pointKey(edge.from);
    const list = outgoing.get(key) ?? [];
    list.push(edge);
    outgoing.set(key, list);
  }

  const used = new Set<string>();
  const loops: Array<readonly GridPoint[]> = [];

  for (const start of edges) {
    if (used.has(start.key)) continue;

    const points: GridPoint[] = [start.from];
    let edge = start;

    while (true) {
      used.add(edge.key);
      if (pointKey(edge.to) === pointKey(start.from)) break;
      points.push(edge.to);

      const candidates = (outgoing.get(pointKey(edge.to)) ?? []).filter(
        (candidate) => !used.has(candidate.key),
      );
      if (candidates.length === 0) {
        throw new Error('Endgame contour boundary did not form a closed loop');
      }

      const priority = nextDirectionPriority(edge.direction);
      candidates.sort(
        (left, right) =>
          priority.indexOf(left.direction) - priority.indexOf(right.direction),
      );
      edge = candidates[0]!;
    }

    loops.push(simplifyLoop(points));
  }

  return Object.freeze(loops);
};

const toDisplayPoint = (
  point: GridPoint,
  lattice: EndgameContourLattice,
): DisplayPoint =>
  Object.freeze({
    x: lattice.originX + (point.x / 2) * lattice.spacing,
    y: lattice.originY + (point.y / 2) * lattice.spacing,
  });

const unitDirection = (from: DisplayPoint, to: DisplayPoint): DisplayPoint => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx !== 0 && dy !== 0) {
    throw new Error('Endgame contour boundary must stay axis-aligned');
  }
  if (dx === 0 && dy === 0) {
    throw new Error('Endgame contour boundary contains a zero-length segment');
  }
  return Object.freeze({ x: Math.sign(dx), y: Math.sign(dy) });
};

const roundedCorners = (
  loop: readonly GridPoint[],
  lattice: EndgameContourLattice,
): readonly RoundedCorner[] => {
  const points = loop.map((point) => toDisplayPoint(point, lattice));
  const radius = lattice.spacing / 2;

  return Object.freeze(
    points.map((point, index) => {
      const previous = points[(index + points.length - 1) % points.length]!;
      const following = points[(index + 1) % points.length]!;
      const incoming = unitDirection(previous, point);
      const outgoing = unitDirection(point, following);
      const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
      if (cross === 0) {
        throw new Error('Endgame contour corner must turn after simplification');
      }

      return Object.freeze({
        entry: Object.freeze({
          x: point.x - incoming.x * radius,
          y: point.y - incoming.y * radius,
        }),
        exit: Object.freeze({
          x: point.x + outgoing.x * radius,
          y: point.y + outgoing.y * radius,
        }),
        sweep: cross > 0 ? 1 : 0,
      });
    }),
  );
};

const normalizedNumber = (value: number): number => {
  if (Math.abs(value) < 1e-9) return 0;
  return Math.round(value * 10000) / 10000;
};

const pointCommand = (point: DisplayPoint): string =>
  `${normalizedNumber(point.x)} ${normalizedNumber(point.y)}`;

const samePoint = (left: DisplayPoint, right: DisplayPoint): boolean =>
  Math.abs(left.x - right.x) < 1e-9 && Math.abs(left.y - right.y) < 1e-9;

const roundedLoopPath = (
  loop: readonly GridPoint[],
  lattice: EndgameContourLattice,
): string => {
  const corners = roundedCorners(loop, lattice);
  if (corners.length === 0) return '';

  const radius = normalizedNumber(lattice.spacing / 2);
  const start = corners[0]!.exit;
  const commands = [`M ${pointCommand(start)}`];
  let cursor = start;

  for (let offset = 1; offset <= corners.length; offset += 1) {
    const corner = corners[offset % corners.length]!;
    if (!samePoint(cursor, corner.entry)) {
      commands.push(`L ${pointCommand(corner.entry)}`);
    }
    commands.push(
      `A ${radius} ${radius} 0 0 ${corner.sweep} ${pointCommand(corner.exit)}`,
    );
    cursor = corner.exit;
  }

  commands.push('Z');
  return commands.join(' ');
};

export const buildEndgameContourPath = (
  cells: readonly EndgameContourCell[],
  lattice: EndgameContourLattice,
): string => {
  if (!Number.isFinite(lattice.originX) || !Number.isFinite(lattice.originY)) {
    throw new Error('Endgame contour lattice origin must be finite');
  }
  if (!Number.isFinite(lattice.spacing) || lattice.spacing <= 0) {
    throw new Error('Endgame contour lattice spacing must be positive');
  }
  if (cells.length === 0) return '';

  return traceBoundaryLoops(boundaryEdges(cells))
    .map((loop) => roundedLoopPath(loop, lattice))
    .join(' ');
};

export const endgameContourStrokeWidth = (spacing: number, stoneRadius: number): number => {
  if (!Number.isFinite(spacing) || spacing <= 0) {
    throw new Error('Endgame contour spacing must be positive');
  }
  if (!Number.isFinite(stoneRadius) || stoneRadius <= 0 || stoneRadius >= spacing / 2) {
    throw new Error('Endgame contour stone radius must be inside half the grid spacing');
  }
  return spacing - stoneRadius * 2;
};
