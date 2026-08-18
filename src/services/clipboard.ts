/**
 * Copies text in browsers and installed Web Clips. iOS Web Clips can omit the
 * modern Clipboard API even when the page is served over HTTPS, so retain the
 * short-lived selection fallback for a user-initiated tap.
 */
export const copyText = async (value: string): Promise<boolean> => {
  const text = String(value || '').trim();
  if (!text || typeof navigator === 'undefined') return false;

  const writeText = navigator.clipboard?.writeText;
  if (writeText) {
    try {
      await writeText.call(navigator.clipboard, text);
      return true;
    } catch {
      // Fall through to the iOS-compatible selection path.
    }
  }

  if (typeof document === 'undefined' || !document.body) return false;
  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.setAttribute('aria-hidden', 'true');
  input.style.cssText = 'position:fixed;top:0;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
  document.body.appendChild(input);
  input.select();
  input.setSelectionRange(0, text.length);

  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    input.remove();
  }
};
