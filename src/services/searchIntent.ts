/** An explicit episode suffix is a file requirement, not an alternate title search. */
export function searchIntent(input: string) {
  const value = input.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const match = value.match(/^(.*?)\s*(?:第\s*(\d{1,4})\s*[集话]|\s+(?:ep|e)\s*(\d{1,4})|(\d{1,4})\s*[集话])\s*$/i);
  const number = Number(match?.[2] || match?.[3] || match?.[4]);
  if (match?.[1]?.trim() && number > 0 && number <= 5000) return { title: match[1].trim(), episode: number };
  return { title: value, episode: undefined };
}
