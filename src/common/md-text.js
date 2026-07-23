// Cheap markdown -> plain text conversion for the search index. Approximate by
// design: full rendering is reserved for viewed documents.

export function mdToPlainText(src) {
  return (
    src
      // fence markers (keep the code text itself)
      .replace(/^ {0,3}(```|~~~).*$/gm, '')
      // headings / blockquotes / list markers / task boxes
      .replace(/^ {0,3}#{1,6}\s+/gm, '')
      .replace(/^ {0,3}>\s?/gm, '')
      .replace(/^ {0,3}([-*+]|\d+[.)])\s+\[( |x|X)\]\s+/gm, '')
      .replace(/^ {0,3}([-*+]|\d+[.)])\s+/gm, '')
      // images and links -> their labels
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
      // wiki links -> label or target
      .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
      .replace(/\[\[([^\]]*)\]\]/g, '$1')
      // html tags
      .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
      // emphasis and inline code markers
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)(?=\S)(.*?)(?<=\S)\1/g, '$2')
      .replace(/~~(.*?)~~/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      // tables and separators
      .replace(/^\s*\|/gm, '')
      .replace(/\|\s*$/gm, '')
      .replace(/\|/g, ' ')
      .replace(/^ {0,3}([-*_]\s*){3,}$/gm, '')
      .replace(/[ \t]+/g, ' ')
  );
}

export function extractHeadings(src) {
  const out = [];
  let inFence = false;
  for (const line of src.split('\n')) {
    if (/^ {0,3}(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (m) out.push(m[2].replace(/`([^`]*)`/g, '$1').trim());
  }
  return out;
}
