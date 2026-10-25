/**
 * Attach CSS to a document or shadow root.
 *
 * Constructable stylesheets come first: they are not inline `<style>`
 * elements, so a page's Content-Security-Policy (WhatsApp's included) cannot
 * refuse them. A `<style>` element is the fallback where they are missing.
 * Returns a function that removes the styles again.
 */
export function attachStyles(root: Document | ShadowRoot, css: string): () => void {
  // nodeType, not instanceof: the Document class differs between the page's
  // and the content script's worlds.
  const isDocument = root.nodeType === 9;
  const doc = isDocument ? root as Document : (root as ShadowRoot).ownerDocument;
  const Sheet = doc.defaultView?.CSSStyleSheet;
  if (Sheet && 'replaceSync' in Sheet.prototype && 'adoptedStyleSheets' in root) {
    try {
      const sheet = new Sheet();
      sheet.replaceSync(css);
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
      return () => { root.adoptedStyleSheets = root.adoptedStyleSheets.filter(s => s !== sheet); };
    } catch {
      // Fall through to a <style> element.
    }
  }
  const style = doc.createElement('style');
  style.setAttribute('data-whatsapp-zaps', '');
  style.textContent = css;
  if (isDocument) ((root as Document).head ?? (root as Document).documentElement).append(style);
  else root.prepend(style);
  return () => style.remove();
}
