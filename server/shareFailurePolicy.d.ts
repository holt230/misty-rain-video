export function shareFailureDisposition(error: unknown): 'unavailable' | 'deferred' | 'restricted' | 'unknown';
export function discardFailedSource(error: unknown): boolean;
