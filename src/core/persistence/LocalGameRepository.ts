import type { GameRepository, SavedGame } from './GameRepository';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export class LocalGameRepository<TState = unknown> implements GameRepository<TState> {
  constructor(
    private readonly prefix = 'gocube:game:',
    private readonly storage: StorageLike = localStorage,
  ) {}

  async save(game: SavedGame<TState>): Promise<void> {
    this.storage.setItem(this.prefix + game.id, JSON.stringify(game));
  }

  async load(id: string): Promise<SavedGame<TState> | null> {
    const raw = this.storage.getItem(this.prefix + id);
    return raw ? (JSON.parse(raw) as SavedGame<TState>) : null;
  }

  async remove(id: string): Promise<void> {
    this.storage.removeItem(this.prefix + id);
  }
}
