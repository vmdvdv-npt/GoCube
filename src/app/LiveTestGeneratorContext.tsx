import {
  createContext,
  useContext,
  type ReactNode,
} from 'react';
import type {
  LiveTestGenerationSpec,
  LiveTestGeneratorType,
} from '../core/endgame/testlab/LiveTestGenerators';

export interface LiveTestGeneratorControls {
  readonly current: LiveTestGenerationSpec | null;
  readonly selectedGenerator: LiveTestGeneratorType;
  readonly seedInput: string;
  readonly busy: boolean;
  readonly onSelectedGeneratorChange: (generator: LiveTestGeneratorType) => void;
  readonly onSeedInputChange: (seed: string) => void;
  readonly onGenerate: (generator: LiveTestGeneratorType) => void;
  readonly onReplay: () => void;
}

const LiveTestGeneratorContext = createContext<LiveTestGeneratorControls | null>(null);

export function LiveTestGeneratorProvider({
  value,
  children,
}: Readonly<{
  value: LiveTestGeneratorControls | null;
  children: ReactNode;
}>) {
  return (
    <LiveTestGeneratorContext.Provider value={value}>
      {children}
    </LiveTestGeneratorContext.Provider>
  );
}

export const useLiveTestGeneratorControls = (): LiveTestGeneratorControls | null =>
  useContext(LiveTestGeneratorContext);
