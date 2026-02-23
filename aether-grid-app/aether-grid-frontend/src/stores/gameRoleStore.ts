import { create } from 'zustand';

/**
 * Rol del usuario en la partida actual (1 = Jugador 1, 2 = Jugador 2).
 * Lo usa el header para mostrar "JUGADOR 1" / "JUGADOR 2" y el color correcto (naranja/celeste).
 */
type GameRole = 1 | 2 | null;

/**
 * Texto de "Estado de envíos" (quién envió, esperando a quién). Se muestra en el panel SISTEMA debajo de Estado.
 */
interface GameRoleState {
  gameRole: GameRole;
  setGameRole: (role: GameRole) => void;
  sendStatusText: string | null;
  setSendStatusText: (text: string | null) => void;
}

export const useGameRoleStore = create<GameRoleState>((set) => ({
  gameRole: null,
  setGameRole: (role) => set({ gameRole: role }),
  sendStatusText: null,
  setSendStatusText: (text) => set({ sendStatusText: text }),
}));
