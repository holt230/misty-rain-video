const invalid = new Set(['QUARK_SHARE_UNAVAILABLE','QUARK_VIDEO_NOT_FOUND','QUARK_SHARE_EMPTY']);
const deferred = new Set(['QUARK_SHARE_LIST_INCOMPLETE','QUARK_SHARE_PROBE_INCOMPLETE','LIBRARY_SCAN_LIMIT','QUARK_SHARE_TOO_LARGE',
  'QUARK_NETWORK_ERROR','QUARK_HTTP_ERROR','QUARK_INVALID_RESPONSE','QUARK_SHARE_ACCESS_FAILED','QUARK_SHARE_LIST_FAILED']);

// A failure to read a directory is not proof that a share was deleted.
export function shareFailureDisposition(error) {
  const code = error?.code;
  if (invalid.has(code)) return 'unavailable';
  if (deferred.has(code) || error?.name === 'AbortError' || error?.name === 'TimeoutError') return 'deferred';
  if (code === 'QUARK_SHARE_PASSCODE_REQUIRED') return 'restricted';
  return 'unknown';
}
export const discardFailedSource = error => ['unavailable','deferred'].includes(shareFailureDisposition(error));
