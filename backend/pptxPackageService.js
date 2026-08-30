const fs = require('fs/promises');
const path = require('path');
const JSZip = require('jszip');

const xmlEscape = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const xmlUnescape = (value) => String(value ?? '')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&');

const replaceAcrossTextRuns = (xml, replacements) => {
  const matches = [...String(xml || '').matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)];
  if (!matches.length) return { xml, replacementsApplied: 0 };
  const runs = matches.map((match) => xmlUnescape(match[1]));
  let replacementsApplied = 0;
  for (const [placeholder, replacement] of Object.entries(replacements)) {
    let combined = runs.join('');
    let position = combined.indexOf(placeholder);
    while (position >= 0) {
      let cursor = 0;
      let startRun = 0;
      let endRun = 0;
      let startOffset = 0;
      let endOffset = 0;
      for (let index = 0; index < runs.length; index += 1) {
        const next = cursor + runs[index].length;
        if (position >= cursor && position < next) {
          startRun = index;
          startOffset = position - cursor;
        }
        const matchEnd = position + placeholder.length;
        if (matchEnd > cursor && matchEnd <= next) {
          endRun = index;
          endOffset = matchEnd - cursor;
          break;
        }
        cursor = next;
      }
      const prefix = runs[startRun].slice(0, startOffset);
      const suffix = runs[endRun].slice(endOffset);
      runs[startRun] = `${prefix}${replacement}${startRun === endRun ? suffix : ''}`;
      for (let index = startRun + 1; index < endRun; index += 1) runs[index] = '';
      if (endRun !== startRun) runs[endRun] = suffix;
      replacementsApplied += 1;
      combined = runs.join('');
      position = combined.indexOf(placeholder, position + String(replacement).length);
    }
  }
  let runIndex = 0;
  const rewritten = String(xml || '').replace(/<a:t>[\s\S]*?<\/a:t>/g, () => `<a:t>${xmlEscape(runs[runIndex++])}</a:t>`);
  return { xml: rewritten, replacementsApplied };
};

const relsPathForPart = (partName) => {
  const parsed = path.posix.parse(partName);
  return path.posix.join(parsed.dir, '_rels', `${parsed.base}.rels`);
};

const relativeTarget = (fromPart, toPart) => path.posix.relative(path.posix.dirname(fromPart), toPart) || path.posix.basename(toPart);

const extractRelationships = (xml) => [...String(xml || '').matchAll(/<Relationship\b([^>]*?)\/?>(?:<\/Relationship>)?/g)]
  .map((match) => ({
    raw: match[0],
    id: match[1].match(/\bId="([^"]+)"/)?.[1] || '',
    type: match[1].match(/\bType="([^"]+)"/)?.[1] || '',
    target: match[1].match(/\bTarget="([^"]+)"/)?.[1] || '',
    external: /\bTargetMode="External"/.test(match[1]),
  }));

const uniquePartName = (preferred, destination, suffix) => {
  if (!destination.file(preferred)) return preferred;
  const parsed = path.posix.parse(preferred);
  let index = 1;
  let candidate = '';
  do {
    candidate = path.posix.join(parsed.dir, `${parsed.name}-${suffix}-${index++}${parsed.ext}`);
  } while (destination.file(candidate));
  return candidate;
};

const importPart = async ({ source, destination, sourcePart, suffix, map, importedParts }) => {
  if (map.has(sourcePart)) return map.get(sourcePart);
  const entry = source.file(sourcePart);
  if (!entry) throw new Error(`PPTX 내부 구성요소를 찾을 수 없습니다: ${sourcePart}`);
  const destinationPart = uniquePartName(sourcePart, destination, suffix);
  map.set(sourcePart, destinationPart);
  destination.file(destinationPart, await entry.async('nodebuffer'));
  importedParts.push({ sourcePart, destinationPart });

  const sourceRelsPath = relsPathForPart(sourcePart);
  const sourceRels = source.file(sourceRelsPath);
  if (sourceRels) {
    let relsXml = await sourceRels.async('string');
    const relationships = extractRelationships(relsXml);
    for (const relationship of relationships) {
      if (relationship.external || !relationship.target) continue;
      const childSourcePart = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePart), relationship.target));
      if (!source.file(childSourcePart)) continue;
      const childDestinationPart = await importPart({ source, destination, sourcePart: childSourcePart, suffix, map, importedParts });
      const rewrittenTarget = relativeTarget(destinationPart, childDestinationPart);
      relsXml = relsXml.replace(relationship.raw, relationship.raw.replace(`Target="${relationship.target}"`, `Target="${rewrittenTarget}"`));
    }
    destination.file(relsPathForPart(destinationPart), relsXml);
  }
  return destinationPart;
};

const appendContentTypes = async (destination, sources) => {
  let destinationXml = await destination.file('[Content_Types].xml').async('string');
  const existingOverrides = new Set([...destinationXml.matchAll(/<Override\b[^>]*PartName="([^"]+)"[^>]*\/>/g)].map((match) => match[1]));
  const existingDefaults = new Set([...destinationXml.matchAll(/<Default\b[^>]*Extension="([^"]+)"[^>]*\/>/g)].map((match) => match[1].toLowerCase()));
  const additions = [];
  for (const { source, importedParts } of sources) {
    const sourceXml = await source.file('[Content_Types].xml').async('string');
    const overrideByPart = new Map([...sourceXml.matchAll(/<Override\b[^>]*PartName="([^"]+)"[^>]*ContentType="([^"]+)"[^>]*\/>/g)].map((match) => [match[1].replace(/^\//, ''), match[2]]));
    for (const item of importedParts) {
      const contentType = overrideByPart.get(item.sourcePart);
      const destinationName = `/${item.destinationPart}`;
      if (contentType && !existingOverrides.has(destinationName)) {
        additions.push(`<Override PartName="${destinationName}" ContentType="${contentType}"/>`);
        existingOverrides.add(destinationName);
      }
    }
    for (const match of sourceXml.matchAll(/<Default\b[^>]*Extension="([^"]+)"[^>]*ContentType="([^"]+)"[^>]*\/>/g)) {
      const extension = match[1].toLowerCase();
      if (!existingDefaults.has(extension)) {
        additions.push(`<Default Extension="${match[1]}" ContentType="${match[2]}"/>`);
        existingDefaults.add(extension);
      }
    }
  }
  destinationXml = destinationXml.replace('</Types>', `${additions.join('')}</Types>`);
  destination.file('[Content_Types].xml', destinationXml);
};

const mergePptxFiles = async (sourcePaths, outputPath, onProgress = () => {}) => {
  if (!Array.isArray(sourcePaths) || sourcePaths.length < 2) throw new Error('PPTX 합치기에는 파일이 두 개 이상 필요합니다.');
  const destination = await JSZip.loadAsync(await fs.readFile(sourcePaths[0]));
  let presentationXml = await destination.file('ppt/presentation.xml').async('string');
  let presentationRelsXml = await destination.file('ppt/_rels/presentation.xml.rels').async('string');
  let nextSlideIndex = Math.max(0, ...Object.keys(destination.files).map((name) => Number(name.match(/^ppt\/slides\/slide(\d+)\.xml$/)?.[1] || 0))) + 1;
  let nextSlideId = Math.max(255, ...[...presentationXml.matchAll(/<p:sldId\b[^>]*\bid="(\d+)"/g)].map((match) => Number(match[1]))) + 1;
  let nextRid = Math.max(0, ...[...presentationRelsXml.matchAll(/\bId="rId(\d+)"/g)].map((match) => Number(match[1]))) + 1;
  const contentTypeSources = [];

  for (let sourceIndex = 1; sourceIndex < sourcePaths.length; sourceIndex += 1) {
    const source = await JSZip.loadAsync(await fs.readFile(sourcePaths[sourceIndex]));
    const importedParts = [];
    const map = new Map();
    const slideNames = Object.keys(source.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));
    for (const sourceSlide of slideNames) {
      const targetSlide = `ppt/slides/slide${nextSlideIndex++}.xml`;
      map.set(sourceSlide, targetSlide);
      destination.file(targetSlide, await source.file(sourceSlide).async('nodebuffer'));
      importedParts.push({ sourcePart: sourceSlide, destinationPart: targetSlide });
      const sourceRels = source.file(relsPathForPart(sourceSlide));
      if (sourceRels) {
        let relsXml = await sourceRels.async('string');
        for (const relationship of extractRelationships(relsXml)) {
          if (relationship.external || !relationship.target) continue;
          const childSourcePart = path.posix.normalize(path.posix.join(path.posix.dirname(sourceSlide), relationship.target));
          if (!source.file(childSourcePart)) continue;
          const childDestinationPart = await importPart({ source, destination, sourcePart: childSourcePart, suffix: `deck${sourceIndex + 1}`, map, importedParts });
          relsXml = relsXml.replace(relationship.raw, relationship.raw.replace(`Target="${relationship.target}"`, `Target="${relativeTarget(targetSlide, childDestinationPart)}"`));
        }
        destination.file(relsPathForPart(targetSlide), relsXml);
      }
      const relationshipId = `rId${nextRid++}`;
      presentationRelsXml = presentationRelsXml.replace('</Relationships>', `<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/${path.posix.basename(targetSlide)}"/></Relationships>`);
      presentationXml = presentationXml.replace('</p:sldIdLst>', `<p:sldId id="${nextSlideId++}" r:id="${relationshipId}"/></p:sldIdLst>`);
    }
    contentTypeSources.push({ source, importedParts });
    onProgress({ completed: sourceIndex + 1, total: sourcePaths.length, stage: 'pptx-merge' });
  }

  destination.file('ppt/presentation.xml', presentationXml);
  destination.file('ppt/_rels/presentation.xml.rels', presentationRelsXml);
  await appendContentTypes(destination, contentTypeSources);
  const buffer = await destination.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, buffer);
  return outputPath;
};

const replacePptxTemplate = async (sourcePath, outputPath, replacements) => {
  const zip = await JSZip.loadAsync(await fs.readFile(sourcePath));
  let replacementsApplied = 0;
  const normalized = Object.fromEntries(Object.entries(replacements || {}).map(([key, value]) => [`{${String(key).replace(/^\{|\}$/g, '')}}`, String(value ?? '')]));
  const editableParts = Object.keys(zip.files).filter((name) => /^ppt\/(slides|notesSlides)\/.+\.xml$/.test(name));
  for (const partName of editableParts) {
    let xml = await zip.file(partName).async('string');
    const replaced = replaceAcrossTextRuns(xml, normalized);
    replacementsApplied += replaced.replacementsApplied;
    zip.file(partName, replaced.xml);
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, buffer);
  return { outputPath, replacementsApplied };
};

module.exports = { mergePptxFiles, replacePptxTemplate, _test: { extractRelationships, relsPathForPart, xmlEscape, xmlUnescape, replaceAcrossTextRuns } };
