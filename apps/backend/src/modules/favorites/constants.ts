// Keep DEFAULT_FAVORITE_TABS and the limits in sync with the storefront's
// lib/pos/favorites.ts. Built-in tabs are not stored in the database - only
// custom tabs and the pinned products are.

export interface FavoriteTab {
  id: string
  label: string
  custom?: boolean
}

export const DEFAULT_FAVORITE_TABS: FavoriteTab[] = [
  { id: 'badminton-stringing', label: 'Badminton Stringing' },
  { id: 'tennis-stringing', label: 'Tennis Stringing' },
  { id: 'squash-stringing', label: 'Squash Stringing' },
  { id: 'shuttles', label: 'Shuttles' },
  { id: 'balls', label: 'Balls' },
  { id: 'grips', label: 'Grips' },
]

export const MAX_FAVORITES_PER_TAB = 50
export const MAX_CUSTOM_TABS = 10
export const MAX_TAB_LABEL_LENGTH = 24
export const CUSTOM_TAB_ID_RE = /^custom-[a-z0-9]{1,40}$/

export const MAX_WISHLIST_ITEMS = 500
