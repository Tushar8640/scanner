import { create } from 'zustand';

interface UiState {
  /** Hides the bottom tab bar, e.g. while a list is in selection mode and shows its own action bar. */
  tabBarHidden: boolean;
  setTabBarHidden: (hidden: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  tabBarHidden: false,
  setTabBarHidden: (tabBarHidden) => set({ tabBarHidden }),
}));
