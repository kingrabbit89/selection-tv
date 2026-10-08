// Text extracted from editorial HTML must compare with canonical plain titles.
// Decode once, after removing real markup: an escaped literal <...> belongs to
// the title and must never be mistaken for a tag or decoded a second time.
const named = {amp:'&',AMP:'&',lt:'<',LT:'<',gt:'>',GT:'>',quot:'"',QUOT:'"',apos:"'",
  nbsp:'\u00a0',laquo:'«',raquo:'»',lsquo:'‘',rsquo:'’',ldquo:'“',rdquo:'”',
  ndash:'–',mdash:'—',hellip:'…',middot:'·',eacute:'é',Eacute:'É',egrave:'è',Egrave:'È',
  ecirc:'ê',Ecirc:'Ê',agrave:'à',Agrave:'À',acirc:'â',Acirc:'Â',ocirc:'ô',Ocirc:'Ô',
  icirc:'î',Icirc:'Î',iuml:'ï',Iuml:'Ï',ugrave:'ù',Ugrave:'Ù',ucirc:'û',Ucirc:'Û',
  ccedil:'ç',Ccedil:'Ç',ouml:'ö',Ouml:'Ö',auml:'ä',Auml:'Ä',uuml:'ü',Uuml:'Ü'};

export function decodeHtmlEntities(value) {
  return String(value || '').replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z][a-z0-9]+);/gi, (entity,key) => {
    if (key[0] !== '#') return named[key] ?? entity;
    const code = /^#x/i.test(key) ? Number.parseInt(key.slice(2),16) : Number.parseInt(key.slice(1),10);
    if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '\ufffd';
    return String.fromCodePoint(code);
  });
}

export const htmlText = value => decodeHtmlEntities(String(value || '').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
