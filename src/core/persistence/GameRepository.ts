export interface SavedGame<TState = unknown> {
  id: string;
  savedAt: string;
  state: TState;
}

export interface GameRepository<TState = unknown> {
  save(game: SavedGame<TState>): Promise<void>;
  load(id: string): Promise<SavedGame<TState> | null>;
  remove(id: string): Promise<void>;
}

/**
 * Persistence boundary for a single active-game slot.
 *
 * Ordinary `save` is allowed to update only the already-active session identity.
 * `activate` is the explicit lifecycle operation that may replace that identity,
 * for example when New Game creates a new session generation.
 */
export interface ActiveGameRepository<TState = unknown>
  extends GameRepository<TState> {
  activate(game: SavedGame<TState>): Promise<void>;
}
