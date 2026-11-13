import { createContext, useContext } from 'react';
import type { SessionUser } from '../shared/types.ts';

export const SessionContext = createContext<SessionUser | null>(null);
export const useSession = () => useContext(SessionContext);
/** true si el usuario actual es el administrador. */
export const useIsAdmin = () => useContext(SessionContext)?.role === 'admin';
