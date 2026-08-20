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
