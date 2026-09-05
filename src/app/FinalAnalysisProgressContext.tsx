import { createContext, useContext, type ReactNode } from 'react';
import type { FinalProofSearchProgressSource } from '../core/endgame/FinalProofSearchRunController';

const FinalAnalysisProgressContext = createContext<FinalProofSearchProgressSource | undefined>(undefined);

export interface FinalAnalysisProgressProviderProps {
  readonly source: FinalProofSearchProgressSource;
  readonly children: ReactNode;
}

export function FinalAnalysisProgressProvider({ source, children }: FinalAnalysisProgressProviderProps) {
  return (
    <FinalAnalysisProgressContext.Provider value={source}>
      {children}
    </FinalAnalysisProgressContext.Provider>
  );
}

export const useFinalAnalysisProgressSource = (): FinalProofSearchProgressSource | undefined =>
  useContext(FinalAnalysisProgressContext);
