/**
 * Stable fingerprint of a phrase's text, used to tell whether the MP3 sitting
 * in Blob was cut from the words the phrase says today. Editing a phrase's
 * wording without changing its id leaves stale audio behind otherwise — the
 * render pass sees a file at the path and skips it.
 *
 * FNV-1a: not cryptographic, just cheap and identical on both sides of the
 * wire, which is all a change check needs.
 */
export function phraseHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    // 32-bit FNV prime multiply, kept in range without BigInt.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
