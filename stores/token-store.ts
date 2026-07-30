"use client"

import { create } from "zustand"
import type { TokenData } from "@/types/token-data"

interface TokenStoreState {
  tokensByMint: Map<string, TokenData>
  displayOrder: string[]
  favoriteMints: Set<string>
  solPrice: number
  toggleFavorite: (mint: string) => Promise<void>
  replaceTokens: (tokens: Map<string, TokenData>, order: string[]) => void
  setCardState: (
    favorites: string[],
    solPrice: number,
    toggleFavorite: (mint: string) => Promise<void>,
  ) => void
}

export const useTokenStore = create<TokenStoreState>((set) => ({
  tokensByMint: new Map(),
  displayOrder: [],
  favoriteMints: new Set(),
  solPrice: 0,
  toggleFavorite: async () => {},
  replaceTokens: (tokensByMint, displayOrder) => set({ tokensByMint, displayOrder }),
  setCardState: (favorites, solPrice, toggleFavorite) =>
    set({ favoriteMints: new Set(favorites), solPrice, toggleFavorite }),
}))
