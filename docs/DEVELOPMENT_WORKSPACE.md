# Development Workspace

The AlphaZero Development Workspace is intended for generation and replay of AI-vs-AI test games.

On first connection it selects the Cube checkpoint with the highest iteration number available from the local AlphaZero service. User changes to the Black checkpoint, White checkpoint, and MCTS simulation count are stored locally and restored on later launches.

If the service reports `generation_busy`, another game is still being generated. Let that request finish, or restart the unified `./dev` session to cancel an abandoned generation.
