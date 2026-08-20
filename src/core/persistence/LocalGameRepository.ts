import type { GameRepository, SavedGame } from './GameRepository';

export class LocalGameRepository<TState = unknown> implements GameRepository<TState> {
  constructor(private readonly prefix = 'gocube:game:') {}

  async save(game: SavedGame<TState>): Promise<void> {
    localStorage.setItem(this.prefix + game.id, JSON.stringify(game));
  }

  async load(id: string): Promise<SavedGame<TState> | null> {
    const raw = localStorage.getItem(this.prefix + id);
    return raw ? (JSON.parse(raw) as SavedGame<TState>) : null;
  }

  async remove(id: string): Promise<void> {
    localStorage.removeItem(this.prefix + id);
  }
}
