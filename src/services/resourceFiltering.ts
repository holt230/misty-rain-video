/** Search providers describe all kinds of shared files as resources, including 4K images. */
export function isNonVideoResource(title: string, keyword = '') {
  let description = title.normalize('NFKC').replace(/\p{Cf}/gu, '');
  // Judge the edition/description, so a film's own name can contain words such as “小说”.
  const name = keyword.normalize('NFKC').replace(/[\s\p{P}\p{S}\p{Cf}]+/gu, '');
  if (name) {
    const pattern = [...name].map(character => character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\p{P}\\p{S}\\p{Cf}]*');
    description = description.replace(new RegExp(pattern, 'giu'), '');
  }
  description = description.replace(/(?:同名)?(?:小说|漫画)(?:改编|原作)/g, '');
  return /壁纸|墙纸|写真|美图|图集|插画|头像|屏保|海报|wallpapers?|screensavers?|有声(?:小说|书)?|播讲|演播|朗读|听书|音频|原声带|广播剧|相声|评书|电子书|小说|漫画|kindle|沙雕版|解说(?:版|视频)|混剪(?:版|视频)/i.test(description)
    || /(?:^|[.\s_\-\[\]()（）])(?:mp3|flac|aac|m4a|wav|ape|ogg|epub|mobi|azw3|pdf|txt|docx?|jpe?g|png|webp|heic)(?=$|[.\s_\-\[\]()（）])/i.test(description);
}
