import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import JSZip from 'jszip';
import { parseWorkbook } from '../server/lib/workbook.js';
import {
  buildFilename,
  chineseNumber,
  inferMeetingType,
  sectionPlanFor,
  speakerPlanFor
} from '../server/lib/meetingRules.js';
import { buildGenerationPrompt } from '../server/lib/prompt.js';
import { recordToDocxBuffer } from '../server/lib/docxExport.js';
import { generateRecord, getApiKey, getBaseURL, getModel } from '../server/lib/ai.js';

describe('workbook parsing', () => {
  test('parses the provided ledger into meeting rows', async () => {
    const rows = await parseWorkbook('../2026年中山大学教育发展基金会党支部党组织生活台账.xlsx');
    expect(rows.length).toBeGreaterThan(10);
    expect(rows[0]).toMatchObject({ category: '支委会会议', dateText: '2026年1月8日', location: '521栋2楼' });
    expect(rows[0].topics.length).toBeGreaterThanOrEqual(2);
  });
});

describe('meeting rules', () => {
  test('uses approved speaker lists', () => {
    expect(speakerPlanFor('支委会').speakers).toEqual(['邓雯文', '刘晓', '林锦玲', '黄瑞敏']);
    expect(speakerPlanFor('党员会').speakers).toEqual(['黄瑞敏', '林娜', '邓雯文', '林锦玲', '刘贻珊', '张超', '蔡坤含', '杜秋平', '刘少静', '刘晓']);
    expect(speakerPlanFor('党日活动').speakers).toEqual(['黄瑞敏', '邓雯文', '刘晓', '林锦玲']);
  });

  test('infers meeting types and stable output filenames', () => {
    expect(inferMeetingType({ category: '支委会会议', topics: [] })).toBe('支委会');
    expect(inferMeetingType({ category: '党员会', topics: ['主题党日活动'] })).toBe('党日活动');
    expect(buildFilename({ dateText: '2026年1月8日', category: '党员会', topics: [] })).toBe('2026年1月8日党员会会议记录.docx');
    expect(buildFilename({ dateText: '2026年1月8日', category: '支委会会议', topics: [] })).toBe('2026年1月8日支委会会议记录.docx');
  });

  test('uses Chinese section numerals', () => {
    expect(chineseNumber(1)).toBe('一');
    expect(chineseNumber(10)).toBe('十');
    expect(chineseNumber(12)).toBe('十二');
    expect(chineseNumber(21)).toBe('二十一');
  });

  test('first learning topic receives all speakers and moves Huang Ruimin last when present', () => {
    const meeting = {
      category: '党员会',
      topics: ['学习贯彻中央八项规定精神', '讨论党建引领业务工作', '部署近期支部工作']
    };
    const sections = sectionPlanFor(meeting);
    const allSpeakers = speakerPlanFor('党员会').speakers;
    expect(sections[0].heading).toBe('一、学习贯彻中央八项规定精神');
    expect(sections[0].speakers).toHaveLength(allSpeakers.length);
    expect(new Set(sections[0].speakers)).toEqual(new Set(allSpeakers));
    for (const section of sections) {
      expect(section.speakers.length).toBeGreaterThan(0);
      if (section.speakers.includes('黄瑞敏')) {
        expect(section.lastSpeaker).toBe('黄瑞敏');
        expect(section.speakers.at(-1)).toBe('黄瑞敏');
      }
      expect(section.lastSpeakerWords).toEqual([200, 250]);
    }
  });

  test('does not force Huang Ruimin into topics where she is not selected', () => {
    const sections = sectionPlanFor({
      category: '党员会',
      topics: ['讨论党建引领业务工作', '部署近期支部工作']
    });

    expect(sections[0].speakers).toEqual(['林娜', '邓雯文', '林锦玲', '黄瑞敏']);
    expect(sections[0].lastSpeaker).toBe('黄瑞敏');
    expect(sections[1].speakers).toEqual(['刘贻珊', '张超', '蔡坤含', '杜秋平']);
    expect(sections[1].lastSpeaker).toBe('杜秋平');
  });

  test('increases Huang Ruimin participation without forcing every topic', () => {
    const sections = sectionPlanFor({
      category: '党员会',
      topics: ['讨论党建引领业务工作', '部署近期支部工作', '研究作风建设要求', '讨论整改落实安排', '研究支部日常工作']
    });

    expect(sections[0].speakers).toEqual(['林娜', '邓雯文', '林锦玲', '黄瑞敏']);
    expect(sections[1].speakers).toEqual(['刘贻珊', '张超', '蔡坤含', '杜秋平']);
    expect(sections[2].speakers).toEqual(['刘少静', '刘晓', '林娜', '黄瑞敏']);
    expect(sections[3].speakers).toEqual(['邓雯文', '林锦玲', '刘贻珊', '张超']);
    expect(sections[4].speakers).toEqual(['蔡坤含', '杜秋平', '刘少静', '黄瑞敏']);
    expect(sections.filter((section) => section.speakers.includes('黄瑞敏'))).toHaveLength(3);
  });
});

describe('prompt rules', () => {
  test('requires per-topic speeches, learning-heavy participation, and last speaker length', () => {
    const prompt = buildGenerationPrompt({
      meeting: {
        category: '党员会',
        dateText: '2026年1月8日',
        location: '521校友楼',
        topics: ['学习贯彻中央八项规定精神', '党建引领业务讨论'],
        note: ''
      },
      styleProfile: null
    });
    expect(prompt).toContain('"sections": [{"heading": string, "topic": string, "speeches"');
    expect(prompt).toContain('第一项学习类议题必须安排全部发言人');
    expect(prompt).toContain('每一项议题最后一名发言人的 content 必须控制在 200-250 字');
    expect(prompt).toContain('不要在发言内容开头添加两个空格');
    expect(prompt).toContain('优先围绕 xlsx 中的议题');
    expect(prompt).toContain('不要编造台账未提供的具体工作事实');
    expect(prompt).toContain('降低“基金会”“校友工作”等实体和业务词出现频率');
    expect(prompt).not.toMatch(/校友资源联络|捐赠募集|项目管理|服务学校高质量发展/);
  });
});

describe('docx export', () => {
  test('creates a docx package buffer', async () => {
    const buffer = await recordToDocxBuffer({
      title: '2026年1月8日支委会会议记录',
      meta: { time: '2026年1月8日', location: '521校友楼', type: '支委会' },
      sections: [{
        heading: '一、学习贯彻中央八项规定精神',
        topic: '学习贯彻中央八项规定精神',
        speeches: [{ speaker: '邓雯文', theme: '八项规定改变中国', content: '要把作风建设要求落实到具体岗位。' }]
      }],
      conclusion: ''
    });
    expect(buffer.slice(0, 2).toString()).toBe('PK');
    expect(buffer.length).toBeGreaterThan(5000);
  });

  test('uses source-like font, centered title, Chinese headings, and no first-line indent', async () => {
    const buffer = await recordToDocxBuffer({
      title: '2026年1月8日支委会会议记录',
      meta: { time: '2026年1月8日', location: '521校友楼', type: '支委会' },
      sections: [{
        heading: '一、学习贯彻中央八项规定精神',
        topic: '学习贯彻中央八项规定精神',
        speeches: [
          { speaker: '邓雯文', theme: '八项规定改变中国', content: '要把作风建设要求落实到具体岗位。' },
          { speaker: '刘晓', theme: '党建引领业务讨论', content: '要把党建要求融入业务推进。' }
        ]
      }],
      conclusion: ''
    });
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('word/document.xml').async('string');
    expect(xml).toContain('仿宋_GB2312');
    expect(xml).toContain('<w:jc w:val="center"/>');
    expect(xml).toContain('一、学习贯彻中央八项规定精神');
    expect(xml).toContain('邓雯文：');
    expect(xml).toContain('要把作风建设要求落实到具体岗位。');
    expect(xml).not.toContain('邓雯文：要把作风建设要求落实到具体岗位。');
    expect(xml.indexOf('邓雯文：')).toBeLessThan(xml.indexOf('要把作风建设要求落实到具体岗位。'));
    expect(xml.indexOf('要把作风建设要求落实到具体岗位。')).toBeLessThan(xml.indexOf('刘晓：'));
    expect(xml).not.toContain('<w:firstLine');
  });
});

describe('deployment defaults', () => {
  test('requires env api key and uses micu base url by default', () => {
    const originalKey = process.env.OPENAI_API_KEY;
    const originalBase = process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    expect(getApiKey()).toBe('');
    expect(getBaseURL()).toBe('https://www.micuapi.ai/v1');
    if (originalKey) process.env.OPENAI_API_KEY = originalKey;
    if (originalBase) process.env.OPENAI_BASE_URL = originalBase;
  });

  test('uses automatic model selection unless env var overrides it', () => {
    const original = process.env.OPENAI_MODEL;
    delete process.env.OPENAI_MODEL;
    expect(getModel()).toBe('');
    process.env.OPENAI_MODEL = 'gpt-5.4';
    expect(getModel()).toBe('gpt-5.4');
    if (original === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = original;
  });

  test('uses independent busy state and one-click generation control', () => {
    const source = fs.readFileSync('client/src/main.jsx', 'utf8');
    expect(source).toContain('busyById');
    expect(source).toContain('一键生成');
    expect(source).toContain('generateAll');
    expect(source).toContain('上传标准格式xlsx');
    expect(source).not.toContain('学习 010 素材');
  });

  test('development client proxies api requests to the express server', () => {
    const config = fs.readFileSync('client/vite.config.js', 'utf8');
    const source = fs.readFileSync('client/src/main.jsx', 'utf8');
    expect(config).toContain("'/api'");
    expect(config).toContain("target: 'http://127.0.0.1:3001'");
    expect(source).toContain('后端返回了非 JSON 内容');
    expect(source).toContain('后端没有返回内容');
  });
});

describe('record generation quality gate', () => {
  test('mock generation creates sections where every topic has speeches and a long final speaker', async () => {
    const original = process.env.MOCK_AI;
    process.env.MOCK_AI = '1';
    const record = await generateRecord({
      meeting: {
        category: '党员会',
        dateText: '2026年1月8日',
        location: '521校友楼',
        topics: ['学习贯彻中央八项规定精神', '党建引领业务讨论'],
        note: ''
      },
      styleProfile: null
    });
    expect(record.sections).toHaveLength(2);
    const allSpeakers = speakerPlanFor('党员会').speakers;
    expect(record.sections[0].speeches.map((speech) => speech.speaker)).toHaveLength(allSpeakers.length);
    expect(new Set(record.sections[0].speeches.map((speech) => speech.speaker))).toEqual(new Set(allSpeakers));
    for (const section of record.sections) {
      expect(section.heading).toMatch(/^[一二三四五六七八九十]+、/);
      expect(section.speeches.length).toBeGreaterThan(0);
      expect(section.speeches.at(-1).speaker).toBe('黄瑞敏');
      expect(section.speeches.at(-1).content.length).toBeGreaterThanOrEqual(190);
      expect(section.speeches.at(-1).content.length).toBeLessThanOrEqual(270);
      for (const speech of section.speeches) {
        expect(speech.content).not.toMatch(/^\s{2}/);
        expect(speech.content).not.toMatch(/基金会|校友|资源联络|项目|捐赠|募集/);
      }
    }
    if (original === undefined) delete process.env.MOCK_AI;
    else process.env.MOCK_AI = original;
  });
});
