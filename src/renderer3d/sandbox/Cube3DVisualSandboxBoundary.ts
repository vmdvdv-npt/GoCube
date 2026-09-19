/**
 * Development-only mount seam for the future Cube 3D visual sandbox.
 *
 * The sandbox implementation is intentionally created without GameSession,
 * GameEngine, persistence, AlphaZero, or any production-game controller. It
 * must build its scene from static/mock visual data owned inside the sandbox.
 */
export interface Cube3DVisualSandboxMount {
  mount(host: HTMLElement): () => void;
}
