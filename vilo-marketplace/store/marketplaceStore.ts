import { create } from 'zustand'
import type { CategorySlug, LocationType, ChatMessage, Service } from '@/lib/types'

export interface ToastEntry {
  id: string
  message: string
  kind: 'error' | 'info' | 'success'
}

interface MarketplaceStore {
  // Filters
  activeCategories: CategorySlug[]
  totalBudget: number | null
  participantsCount: number | null
  locationTypes: LocationType[]
  searchQuery: string
  aiSearchLabel: string | null
  setFilter: <K extends keyof FilterKeys>(key: K, value: FilterKeys[K]) => void
  clearFilters: () => void

  // Concierge
  conciergeOpen: boolean
  chatMessages: ChatMessage[]
  pendingMessage: string
  pendingCategory: CategorySlug | null
  openConcierge: (message?: string) => void
  openConciergeWithCategory: (category: CategorySlug) => void
  closeConcierge: () => void
  addMessage: (msg: ChatMessage) => void
  updateLastAssistantMessage: (content: string) => void
  clearChat: () => void
  applyAIFilters: (filters: AISearchFilters) => void

  // UI
  selectedService: Service | null
  setSelectedService: (s: Service | null) => void

  // Toasts (non-blocking notifications)
  toasts: ToastEntry[]
  pushToast: (message: string, kind?: ToastEntry['kind']) => void
  dismissToast: (id: string) => void

  // Admin viewer mode — true when the marketplace is being browsed by a
  // signed-in admin. Hydrated once via /api/admin/me and used to render
  // inline edit affordances on cards / modal.
  isAdmin: boolean
  setIsAdmin: (v: boolean) => void
}

interface FilterKeys {
  activeCategories: CategorySlug[]
  totalBudget: number | null
  participantsCount: number | null
  locationTypes: LocationType[]
  searchQuery: string
  aiSearchLabel: string | null
}

interface AISearchFilters {
  categories?: CategorySlug[]
  total_budget?: number | null
  participants?: number | null
  location?: LocationType | null
  query?: string
  explanation?: string
}

const initialFilters: FilterKeys = {
  activeCategories: [],
  totalBudget: null,
  participantsCount: null,
  locationTypes: ['onsite', 'remote', 'both'],
  searchQuery: '',
  aiSearchLabel: null,
}

export const useMarketplaceStore = create<MarketplaceStore>((set) => ({
  ...initialFilters,

  setFilter: (key, value) => set({ [key]: value }),

  clearFilters: () => set({ ...initialFilters }),

  // Concierge
  conciergeOpen: false,
  chatMessages: [],
  pendingMessage: '',
  pendingCategory: null,

  openConcierge: (message?: string) =>
    set({ conciergeOpen: true, pendingMessage: message || '', pendingCategory: null }),

  openConciergeWithCategory: (category: CategorySlug) =>
    set({ conciergeOpen: true, pendingCategory: category, pendingMessage: '' }),

  closeConcierge: () => set({ conciergeOpen: false }),

  addMessage: (msg) =>
    set((state) => ({ chatMessages: [...state.chatMessages, msg] })),

  updateLastAssistantMessage: (content) =>
    set((state) => {
      const messages = [...state.chatMessages]
      const lastIdx = messages.length - 1
      if (lastIdx >= 0 && messages[lastIdx].role === 'assistant') {
        messages[lastIdx] = { ...messages[lastIdx], content }
      }
      return { chatMessages: messages }
    }),

  clearChat: () => set({ chatMessages: [] }),

  applyAIFilters: (filters) =>
    set({
      activeCategories: filters.categories || [],
      totalBudget: filters.total_budget ?? null,
      participantsCount: filters.participants ?? null,
      locationTypes: filters.location
        ? [filters.location]
        : ['onsite', 'remote', 'both'],
      searchQuery: filters.query || '',
      aiSearchLabel: filters.explanation || null,
    }),

  // UI
  selectedService: null,
  setSelectedService: (s) => set({ selectedService: s }),

  // Toasts
  toasts: [],
  pushToast: (message, kind = 'info') => {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `t_${Date.now()}_${Math.random()}`
    set((state) => ({ toasts: [...state.toasts, { id, message, kind }] }))
  },
  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

  // Admin
  isAdmin: false,
  setIsAdmin: (v) => set({ isAdmin: v }),
}))
