import { AlignmentType, Document, Packer, Paragraph, TextRun } from 'docx';
import { buildFilename } from './meetingRules.js';

const FONT = '仿宋_GB2312';

function paragraph(text, options = {}) {
  return new Paragraph({
    alignment: options.alignment,
    spacing: { before: options.before || 0, after: options.after ?? 120, line: 360 },
    children: [
      new TextRun({
        text,
        font: FONT,
        size: options.size || 28,
        bold: options.bold || false
      })
    ]
  });
}

function blankParagraph() {
  return new Paragraph({
    spacing: { before: 0, after: 120, line: 360 },
    children: [new TextRun({ text: '', font: FONT, size: 28 })]
  });
}

function stripNumber(heading = '') {
  return heading.replace(/^\d+\.\s*/, '').replace(/^[一二三四五六七八九十]+、\s*/, '');
}

function speechesForSection(record, section, index) {
  if (Array.isArray(section.speeches) && section.speeches.length) return section.speeches;
  const speeches = record.speeches || [];
  const topic = section.topic || stripNumber(section.heading);
  const matched = speeches.filter((speech) => speech.topic === topic);
  if (matched.length) return matched;
  return speeches.filter((_, speechIndex) => speechIndex % Math.max((record.sections || []).length, 1) === index);
}

export async function recordToDocxBuffer(record) {
  const sections = record.sections?.length
    ? record.sections
    : [{ heading: '一、交流发言', topic: '交流发言', speeches: record.speeches || [] }];
  const children = [
    paragraph(record.title, { bold: true, size: 32, alignment: AlignmentType.CENTER, after: 260 })
  ];

  sections.forEach((section, index) => {
    children.push(paragraph(section.heading, { size: 28, after: 120 }));
    const speeches = speechesForSection(record, section, index);
    speeches.forEach((speech, speechIndex) => {
      children.push(paragraph(`${speech.speaker}：`, { size: 28, after: 40 }));
      children.push(paragraph(String(speech.content || '').replace(/^[\s　]+/, ''), { size: 28, after: 120 }));
      if (speechIndex < speeches.length - 1) children.push(blankParagraph());
    }
    );
  });

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 28 } } } },
    sections: [{
      properties: {
        page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } }
      },
      children
    }]
  });
  return Packer.toBuffer(doc);
}

export function outputFilenameFor(meeting) {
  return buildFilename(meeting).replace(/[\\/:*?"<>|]/g, '_');
}
