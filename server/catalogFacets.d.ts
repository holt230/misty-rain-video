export interface CatalogFilters { genre: string; country: string; year: string }
export interface CatalogMetadata { genres?: string[]; countries?: string[]; card_subtitle?: string; description?: string; year?: string }
export const CATALOG_GENRES: string[];
export const CATALOG_COUNTRIES: string[];
export function catalogFacets(item: CatalogMetadata): { genres: string[]; countries: string[] };
export function catalogYears(now?: number): string[];
export function hasCatalogFilters(filters: CatalogFilters): boolean;
