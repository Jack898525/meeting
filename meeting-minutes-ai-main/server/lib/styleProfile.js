import fs from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';
import { materialRoot, styleProfilePath } from './paths.js';
import { inferMeetingType } from './meetingRules.js';

const knownNames = new Set(['邓雯文', '刘晓', '林锦玲', '刘贻珊', '张超', '蔡坤含', '杜秋平', '林娜', '刘少静', '黄瑞敏']);

function listDocx(dir) {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.docx') && !entry.name.startsWith('~$'))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function namesFromText(text) {
  return [...text.matchAll(/([\u4e00-\u9fa5]{2,4})[:：]/g)].map((match) => match[1])
    .filter((name) => knownNames.has(name));
}

export async function analyzeMaterials() {
  const files = ['上半年', '下半年']
    .map((folder) => path.join(materialRoot, folder))
    .filter(fs.existsSync)
    .flatMap(listDocx);

  const byType = {};
  for (const file of files) {
    const { value } = await mammoth.extractRawText({ path: file });
    const meeting = { category: path.basename(file), topics: [value.slice(0, 300)], note: '' };
    const type = inferMeetingType(meeting);
    byType[type] ||= { files: 0, speakers: {}, sampleTitles: [] };
    byType[type].files += 1;
    byType[type].sampleTitles.push(path.basename(file));
    for (const name of namesFromText(value)) {
      byType[type].speakers[name] = (byType[type].speakers[name] || 0) + 1;
    }
  }

  const summary = Object.fromEntries(Object.entries(byType).map(([type, data]) => [
    type,
    {
      files: data.files,
      commonSpeakers: Object.entries(data.speakers).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name]) => name),
      sampleTitles: data.sampleTitles.slice(0, 8)
    }
  ]));

  const profile = {
    generatedAt: new Date().toISOString(),
    summary,
    styleRules: [
      '标题通常包含日期和会议类型。',
      '正文按议题展开，学习类议题后跟党员或支委交流发言。',
      '发言内容以学习体会、岗位结合、下一步落实为主。',
      '支委会发言人数少于党员会，党员会通常覆盖更多党员。'
    ]
  };
  fs.writeFileSync(styleProfilePath, JSON.stringify(profile, null, 2), 'utf8');
  return profile;
}

export function loadStyleProfile() {
  if (!fs.existsSync(styleProfilePath)) return null;
  return JSON.parse(fs.readFileSync(styleProfilePath, 'utf8'));
}
