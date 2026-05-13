import OpenAI from 'openai';
import { buildGenerationPrompt, buildRevisionPrompt } from './prompt.js';
import { inferMeetingType, sectionPlanFor, speakerPlanFor, titleFor } from './meetingRules.js';

const BUILT_IN_BASE_URL = 'https://www.micuapi.ai/v1';
const MODEL_PREFERENCE = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.2'];
const THEMES = ['八项规定改变中国', '党建引领业务讨论'];

export function getApiKey() {
  return process.env.OPENAI_API_KEY || '';
}

export function getModel() {
  return process.env.OPENAI_MODEL || '';
}

export function getBaseURL() {
  return process.env.OPENAI_BASE_URL || BUILT_IN_BASE_URL;
}

function createClient(options = {}) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('缺少 OpenAI API key。');
  return new OpenAI({
    apiKey,
    baseURL: getBaseURL(),
    timeout: options.timeout || 120000,
    maxRetries: options.maxRetries ?? 1
  });
}

export async function listAvailableModels() {
  const client = createClient({ timeout: 60000, maxRetries: 0 });
  try {
    const models = await client.models.list();
    return models.data.map((model) => model.id).sort();
  } catch (error) {
    const message = error?.response?.data?.error?.message || error?.error?.message || error?.message || String(error);
    throw new Error(`模型列表获取失败：${message}`);
  }
}

async function resolveModel() {
  const explicit = getModel();
  if (explicit) return explicit;

  const ids = await listAvailableModels();
  const selected = MODEL_PREFERENCE.find((model) => ids.includes(model));
  if (!selected) throw new Error(`未找到可自动选择的文本生成模型。当前 key 可见模型：${ids.join('、')}`);
  return selected;
}

function parseJson(text) {
  const trimmed = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  return JSON.parse(trimmed);
}

function cleanContent(value) {
  return String(value || '').replace(/^[\s　]+/, '').trim();
}

function fallbackContent({ speaker, topic, theme, last }) {
  if (last) {
    return `我认为，围绕“${topic}”，关键是把学习要求转化为支部建设和岗位履责的稳定要求。中央八项规定精神改变的是党员干部的工作状态，也提醒我们少一些形式化安排，多一些务实作风和规范意识。下一步要把党建引领要求体现在日常履职、制度执行、沟通协同和自我约束中，坚持从思想上对标、从作风上改进、从纪律上从严、从行动上落实，用更稳妥的态度做好基础工作，用更严实的标准提升服务质效，推动学习成果体现在党员干部的精神状态和工作作风上。`;
  }
  if (theme === '党建引领业务讨论') {
    return `我围绕“${topic}”谈一点认识。党建引领不能停留在口号上，要体现在日常履职、规范执行和作风改进中。我们要把党员责任落实到岗位要求里，通过更严谨的态度、更主动的沟通、更规范的流程，把支部建设要求转化为提升服务质效的实际行动。`;
  }
  return `我围绕“${topic}”谈一点认识。八项规定改变中国，首先改变的是工作作风和服务意识。联系到支部日常工作，我们要减少空泛表态，把严实要求落实到会议组织、岗位履责和日常协同中，做到态度更认真、执行更规范、沟通更主动、纪律更严格。`;
}

function normalizeTheme(theme, index) {
  return THEMES.includes(theme) ? theme : THEMES[index % THEMES.length];
}

function findSpeech(record, topic, speaker) {
  const section = (record.sections || []).find((item) => item.topic === topic || item.heading?.includes(topic));
  const sectionSpeech = section?.speeches?.find((speech) => speech.speaker === speaker && speech.content);
  if (sectionSpeech) return sectionSpeech;
  return (record.speeches || []).find((speech) => speech.speaker === speaker && speech.content && (!speech.topic || speech.topic === topic));
}

function normalizeRecord(record, meeting) {
  const type = inferMeetingType(meeting);
  const plannedSections = sectionPlanFor(meeting);
  const sections = plannedSections.map((section) => ({
    heading: section.heading,
    topic: section.topic,
    speeches: section.speakers.map((speaker, index) => {
      const match = findSpeech(record || {}, section.topic, speaker);
      const theme = normalizeTheme(match?.theme, index);
      return {
        speaker,
        theme,
        content: cleanContent(match?.content) || fallbackContent({
          speaker,
          topic: section.topic,
          theme,
          last: index === section.speakers.length - 1
        })
      };
    })
  }));

  return {
    title: titleFor(meeting),
    meta: { time: meeting.dateText, location: meeting.location, type },
    sections,
    conclusion: ''
  };
}

function fallbackRecord(meeting) {
  return normalizeRecord({}, meeting);
}

function validateRecord(record, meeting) {
  const plan = sectionPlanFor(meeting);
  if (!Array.isArray(record.sections) || record.sections.length !== plan.length) {
    throw new Error('AI 返回的会议记录章节数量不符合台账议题，请重试生成。');
  }

  record.sections.forEach((section, sectionIndex) => {
    const expectedSpeakers = plan[sectionIndex].speakers;
    const actual = Array.isArray(section.speeches) ? section.speeches : [];
    const missing = expectedSpeakers.filter((speaker) => !actual.some((item) => item.speaker === speaker && item.content));
    if (missing.length) throw new Error(`AI 返回的第 ${sectionIndex + 1} 项议题缺少发言稿：${missing.join('、')}。请重试生成。`);
    for (const speech of actual) {
      if (!THEMES.includes(speech.theme)) {
        throw new Error(`AI 返回的发言主题不符合要求：${speech.speaker || '未知发言人'}。请重试生成。`);
      }
      if (/^[\s　]{2}/.test(speech.content || '')) {
        throw new Error(`AI 返回的发言内容开头存在空格：${speech.speaker || '未知发言人'}。请重试生成。`);
      }
    }
  });

  return record;
}

async function callOpenAI(prompt) {
  const client = createClient();
  try {
    const response = await client.responses.create({
      model: await resolveModel(),
      input: prompt,
      reasoning: { effort: 'medium' }
    });
    return parseJson(response.output_text);
  } catch (error) {
    const message = error?.response?.data?.error?.message || error?.error?.message || error?.message || String(error);
    throw new Error(`API 调用失败：${message}`);
  }
}

export async function generateRecord({ meeting, styleProfile }) {
  if (process.env.MOCK_AI === '1') return fallbackRecord(meeting);
  const record = normalizeRecord(await callOpenAI(buildGenerationPrompt({ meeting, styleProfile })), meeting);
  return validateRecord(record, meeting);
}

export async function reviseRecord({ record, instruction }) {
  if (process.env.MOCK_AI === '1') {
    return {
      ...record,
      sections: (record.sections || []).map((section) => ({
        ...section,
        speeches: (section.speeches || []).map((speech) => ({
          ...speech,
          content: cleanContent(speech.content)
        }))
      })),
      revisionNote: `已根据修改意见调整：${instruction}`
    };
  }
  return callOpenAI(buildRevisionPrompt({ record, instruction }));
}

export { normalizeRecord };
