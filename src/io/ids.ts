/** Globally unique row id – needed so that rows created offline on different laptops never collide when synced. */
export function newId(): string {
  return globalThis.crypto.randomUUID();
}

/** Next human-readable code in a log, e.g. 'CR-027' after 'CR-026'. */
export function nextCode(prefix: string, existing: unknown[]): string {
  let max = 0, width = 0;
  for (const c of existing) {
    if (typeof c !== 'string' || !c.startsWith(prefix)) continue;
    const digits = c.slice(prefix.length);
    if (!/^\d+$/.test(digits)) continue;
    max = Math.max(max, Number(digits));
    width = Math.max(width, digits.length);
  }
  width ||= 3;
  return prefix + String(max + 1).padStart(width, '0');
}
