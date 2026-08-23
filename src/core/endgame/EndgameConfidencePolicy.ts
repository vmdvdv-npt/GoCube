export const ENDGAME_CONFIDENCE_ALGORITHM = 'engine2-confidence-classifier-v1';

export interface EndgameConfidencePolicy {
  readonly algorithm: typeof ENDGAME_CONFIDENCE_ALGORITHM;
  readonly defaultThreshold: number;
  readonly dominanceMargin: number;
  readonly localPressureRadius: number;
  readonly remoteEnemyDistance: number;
  readonly safeEnemyDistance: number;
  readonly largeOpenRegionPoints: number;
  readonly largeOpenRegionFraction: number;
  readonly veryLargeOpenRegionFraction: number;
  readonly largeLibertyCount: number;
  readonly veryLargeLibertyCount: number;
  readonly broadEscapeCount: number;
  readonly minimumOnwardEmptyNeighbors: number;
  readonly narrowFrontierMaximum: number;
  readonly highContestedLibertyRatio: number;
  readonly highDirectEnemyEdgeRatio: number;
  readonly highLocalEnemyDensity: number;
  readonly smallEyeMaxRegionPoints: number;
  readonly smallEyeNodeBudget: number;
  readonly baseScores: Readonly<{ alive: number; dead: number; seki: number }>;
  readonly aliveWeights: Readonly<{
    libertyLarge: number;
    libertyVeryLarge: number;
    openRegionLarge: number;
    openRegionVeryLarge: number;
    escapeBreadth: number;
    frontierBreadth: number;
    enemyFar: number;
    enemyRemote: number;
    lowPressure: number;
    friendlyConnection: number;
    twoEyes: number;
  }>;
  readonly deadWeights: Readonly<{
    atari: number;
    twoLiberties: number;
    contestedLiberties: number;
    directEnemyContact: number;
    localEnemyPressure: number;
    narrowBottleneck: number;
    noBroadEscape: number;
    smallOpenSpace: number;
  }>;
  readonly caps: Readonly<{
    atariAlive: number;
    twoLibertyAlive: number;
    narrowBottleneckAlive: number;
    enclosedAlive: number;
    broadEscapeDead: number;
    expandingAtariDead: number;
    expandingTwoLibertyDead: number;
  }>;
}

export const DEFAULT_ENDGAME_CONFIDENCE_POLICY: EndgameConfidencePolicy = Object.freeze({
  algorithm: ENDGAME_CONFIDENCE_ALGORITHM,
  defaultThreshold: 0.9,
  dominanceMargin: 0.05,
  localPressureRadius: 3,
  remoteEnemyDistance: 8,
  safeEnemyDistance: 5,
  largeOpenRegionPoints: 18,
  largeOpenRegionFraction: 0.08,
  veryLargeOpenRegionFraction: 0.25,
  largeLibertyCount: 4,
  veryLargeLibertyCount: 6,
  broadEscapeCount: 3,
  minimumOnwardEmptyNeighbors: 2,
  narrowFrontierMaximum: 1,
  highContestedLibertyRatio: 0.5,
  highDirectEnemyEdgeRatio: 0.5,
  highLocalEnemyDensity: 0.18,
  smallEyeMaxRegionPoints: 6,
  smallEyeNodeBudget: 512,
  baseScores: Object.freeze({ alive: 0.08, dead: 0.06, seki: 0.02 }),
  aliveWeights: Object.freeze({
    libertyLarge: 0.12,
    libertyVeryLarge: 0.08,
    openRegionLarge: 0.22,
    openRegionVeryLarge: 0.12,
    escapeBreadth: 0.16,
    frontierBreadth: 0.1,
    enemyFar: 0.1,
    enemyRemote: 0.08,
    lowPressure: 0.08,
    friendlyConnection: 0.04,
    twoEyes: 0.48,
  }),
  deadWeights: Object.freeze({
    atari: 0.48,
    twoLiberties: 0.16,
    contestedLiberties: 0.18,
    directEnemyContact: 0.16,
    localEnemyPressure: 0.16,
    narrowBottleneck: 0.16,
    noBroadEscape: 0.12,
    smallOpenSpace: 0.12,
  }),
  caps: Object.freeze({
    atariAlive: 0.35,
    twoLibertyAlive: 0.68,
    narrowBottleneckAlive: 0.82,
    enclosedAlive: 0.72,
    broadEscapeDead: 0.72,
    expandingAtariDead: 0.82,
    expandingTwoLibertyDead: 0.84,
  }),
});
