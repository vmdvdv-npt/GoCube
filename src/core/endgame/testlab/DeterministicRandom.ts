const hashSeed = (seed: string | number): number => {
  const text = String(seed);
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  const normalized = hash >>> 0;
  return normalized === 0 ? 0x6d2b79f5 : normalized;
};

/** Small deterministic PRNG for reproducible test fixtures. */
export class DeterministicRandom {
  private state: number;

  constructor(readonly seed: string | number) {
    this.state = hashSeed(seed);
  }

  nextUint32(): number {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state;
  }

  next(): number {
    return this.nextUint32() / 0x1_0000_0000;
  }

  integer(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0) {
      throw new Error(`maxExclusive must be a positive safe integer, got ${String(maxExclusive)}`);
    }
    return Math.floor(this.next() * maxExclusive);
  }

  pick<T>(values: readonly T[]): T {
    if (values.length === 0) throw new Error('Cannot pick from an empty collection');
    return values[this.integer(values.length)]!;
  }

  shuffle<T>(values: readonly T[]): readonly T[] {
    const shuffled = [...values];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = this.integer(index + 1);
      [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
    }
    return Object.freeze(shuffled);
  }
}
