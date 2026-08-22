import type { GameState, StoneColor } from '../../game/types';
import type { PointId } from '../../topology/Topology';

export const ENDGAME_TEST_GENERATOR_VERSION = 1 as const;

export type EndgameTestTopologyKind = 'torus' | 'cube';

export interface EndgameTestTopologyDescriptor {
  readonly kind: EndgameTestTopologyKind;
  readonly size: number;
  readonly id: string;
}

export type GeneratedGameCommand =
  | Readonly<{ type: 'place-stone'; point: PointId }>
  | Readonly<{ type: 'pass' }>;

export interface SyntheticPlacement {
  readonly point: PointId;
  readonly color: StoneColor;
}

export type LifeDeathPatternName = 'single-eye' | 'two-eyes' | 'false-eye' | 'atari-group';
export type SekiPatternName = 'shared-liberties' | 'ambiguous-contact';
export type StressPatternName = 'single-eye' | 'false-eye' | 'shared-liberties';
export type TopologyStressMode = 'torus-seam' | 'cube-edge' | 'cube-corner';

interface BaseGeneratorMetadata {
  readonly version: typeof ENDGAME_TEST_GENERATOR_VERSION;
  readonly seed: string;
}

export type EndgameGeneratorMetadata =
  | Readonly<
      BaseGeneratorMetadata & {
        kind: 'legal-game';
        options: Readonly<{ maxMoves: number }>;
      }
    >
  | Readonly<
      BaseGeneratorMetadata & {
        kind: 'endgame-position';
        options: Readonly<{ maxMoves: number }>;
      }
    >
  | Readonly<
      BaseGeneratorMetadata & {
        kind: 'life-death-pattern';
        options: Readonly<{ pattern: LifeDeathPatternName }>;
      }
    >
  | Readonly<
      BaseGeneratorMetadata & {
        kind: 'seki-pattern';
        options: Readonly<{ pattern: SekiPatternName }>;
      }
    >
  | Readonly<
      BaseGeneratorMetadata & {
        kind: 'topology-stress';
        options: Readonly<{
          mode: TopologyStressMode;
          pattern: StressPatternName;
        }>;
      }
    >;

export interface EndgameTestFixture {
  readonly fixtureId: string;
  readonly topology: EndgameTestTopologyDescriptor;
  readonly state: GameState;
  readonly commands: readonly GeneratedGameCommand[];
  readonly placements: readonly SyntheticPlacement[];
  readonly tags: readonly string[];
  readonly generator: EndgameGeneratorMetadata;
}

const stableMetadataText = (metadata: EndgameGeneratorMetadata): string => {
  const optionEntries = Object.entries(metadata.options).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const options = optionEntries.map(([key, value]) => `${key}=${String(value)}`).join(',');
  return `${metadata.kind}:v${metadata.version}:seed=${metadata.seed}:${options}`;
};

export const endgameFixtureId = (
  topology: EndgameTestTopologyDescriptor,
  metadata: EndgameGeneratorMetadata,
): string => `${topology.id}:${stableMetadataText(metadata)}`;
