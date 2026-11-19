const rank = { sdr: 0, unknown: 1, hdr: 2, 'dolby-vision': 3 };

// These are release labels. A share listing does not prove how a video decodes.
export function sourceColor(label) {
  const text = String(label || '').normalize('NFKC');
  if (/杜比视界|dolby[\s._-]*vision|(?:^|[^a-z\d])dv(?:p?[578])?(?=$|[^a-z\d])/i.test(text)) return 'dolby-vision';
  if (/(?:^|[^a-z\d])(?:hdr(?:10\+?)?|hlg)(?=$|[^a-z\d])/i.test(text)) return 'hdr';
  if (/(?:^|[^a-z\d])sdr(?=$|[^a-z\d])/i.test(text)) return 'sdr';
  return 'unknown';
}

export const sourceColorRank = color => rank[color] ?? rank.unknown;
export const firstLabeledColor = labels => labels.map(sourceColor).find(color => color !== 'unknown') || 'unknown';

export function fileSourceColor(entry, folderNames, releaseTitle = '') {
  const labels = [entry.name, ...(entry.ancestorFids || []).slice().reverse().map(fid => folderNames.get(fid)), releaseTitle];
  return firstLabeledColor(labels);
}

export function leastCompatibleColor(colors) {
  let worst;
  for (const color of colors) if (!worst || sourceColorRank(color) > sourceColorRank(worst)) worst = color;
  return worst || 'unknown';
}
