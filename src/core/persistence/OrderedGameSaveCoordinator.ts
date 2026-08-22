import type { GameRepository, SavedGame } from './GameRepository';

/**
 * Serializes session saves so a later revision cannot reach storage before an
 * earlier write has settled. A failed write is still reported to its caller,
 * but it does not permanently poison the queue for future saves.
 */
export class OrderedGameSaveCoordinator<TState = unknown> {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly repository: GameRepository<TState>) {}

  save(game: SavedGame<TState>): Promise<void> {
    const write = this.tail.then(() => this.repository.save(game));
    this.tail = write.catch(() => undefined);
    return write;
  }
}
