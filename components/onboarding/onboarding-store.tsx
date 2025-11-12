"use client"

import { create } from "zustand"

interface OnboardingState {
  isOnboardingActive: boolean
  setOnboardingActive: (active: boolean) => void
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  isOnboardingActive: false,
  setOnboardingActive: (active) => set({ isOnboardingActive: active }),
}))
