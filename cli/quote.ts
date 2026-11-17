/** Encode untrusted data so it cannot inject terminal controls or reorder text. */
export function quoteTerminal(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) return 'null';
  return encoded.replace(/[\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
