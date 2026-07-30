import { create } from "zustand"

export interface AlertModalToken {
  mint: string
  name: string
  symbol: string
  usd_market_cap: number
}

interface AlertModalState {
  isOpen: boolean
  token: AlertModalToken | null
  open: (token: AlertModalToken) => void
  close: () => void
}

export const useAlertModalStore = create<AlertModalState>((set) => ({
  isOpen: false,
  token: null,
  open: (token) => set({ isOpen: true, token }),
  close: () => set({ isOpen: false, token: null }),
}))
