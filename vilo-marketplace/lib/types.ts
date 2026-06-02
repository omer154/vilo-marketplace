export type PricingUnit = 'person' | 'group' | 'hour' | 'project' | 'month' | 'unit'
export type LocationType = 'onsite' | 'remote' | 'both'
export type LocationMode = 'at_client' | 'at_provider' | 'remote' | 'hybrid'
export type CategorySlug =
  | 'wellbeing'
  | 'teambuilding'
  | 'learning'
  | 'food'
  | 'culture'
  | 'travel'
  | 'sport'
  | 'tech'
  | 'consulting'

export interface Supplier {
  id: string
  name: string
  name_en?: string | null
  slug: string
  logo_url: string | null
  website?: string | null
  contact_email: string | null
  description_short: string | null
  /** Optional link to the supplier's cancellation & order-change terms
   *  ("תנאי ביטול ושינוי הזמנה"), shown on the supplier and every service. */
  cancellation_terms_url?: string | null
  is_active: boolean
  services?: Service[]
}

export interface Service {
  id: string
  supplier_id: string
  supplier_name?: string
  supplier_logo_url?: string | null
  /** The owning supplier's cancellation-terms link, joined onto the service so
   *  the detail view can show it. Populated on the supplier page + in search. */
  supplier_cancellation_terms_url?: string | null
  service_name: string
  category_primary: CategorySlug
  category_secondary: string | null
  description_short: string | null
  tags: string[] | null
  duration_minutes: number | null
  location_type: LocationType
  location_mode?: LocationMode | null
  language: string
  min_participants: number | null
  max_participants: number | null
  price: number | null
  pricing_unit: PricingUnit | null
  notes: string | null
  is_active: boolean
}

export interface Category {
  slug: CategorySlug
  name_he: string
  icon: string
  color_bg: string
  color_text: string
  color_dot: string
  sort_order: number
}

export interface FilterState {
  activeCategories: CategorySlug[]
  budgetMax: number | null
  participantsCount: number | null
  locationTypes: LocationType[]
  searchQuery: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  matchedServices?: Service[]
}
