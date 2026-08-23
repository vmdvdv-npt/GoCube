import {
  createContext,
  useContext,
  type ReactNode,
} from 'react';
import type { ReplayableTestCase } from '../core/endgame/testlab/TestCase';

export interface LiveTestGeneratorControls {
  readonly current: ReplayableTestCase | null;
  readonly testIdInput: string;
  readonly busy: boolean;
  readonly feedback: string | null;
  readonly onTestIdInputChange: (testId: string) => void;
  readonly onGenerateGame: () => void;
  readonly onGenerateEndgame: () => void;
  readonly onGenerateCorpus: () => void;
  readonly onLoadTestId: () => void;
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
