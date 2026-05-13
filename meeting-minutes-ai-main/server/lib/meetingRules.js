const committeeSpeakers = ['邓雯文', '刘晓', '林锦玲', '黄瑞敏'];
const memberSpeakers = ['黄瑞敏', '林娜', '邓雯文', '林锦玲', '刘贻珊', '张超', '蔡坤含', '杜秋平', '刘少静', '刘晓'];
const partyDaySpeakers = ['黄瑞敏', '邓雯文', '刘晓', '林锦玲'];

const chineseDigits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

export function chineseNumber(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return String(value);
  if (number < 10) return chineseDigits[number];
  if (number === 10) return '十';
  if (number < 20) return `十${chineseDigits[number % 10]}`;
  if (number < 100) {
    const tens = Math.floor(number / 10);
    const ones = number % 10;
    return `${chineseDigits[tens]}十${ones ? chineseDigits[ones] : ''}`;
  }
  return String(value);
}

export function inferMeetingType(meeting) {
  const text = `${meeting.category || ''} ${(meeting.topics || []).join(' ')} ${meeting.note || ''} ${meeting.templateHint || ''}`;
  if (/党日|党组织活动|联建|集体学习/.test(text)) return '党日活动';
  if (/支委|支部委员/.test(text)) return '支委会';
  if (/党员|支部会议|党员大会/.test(text)) return '党员会';
  return '党员会';
}

export function speakerPlanFor(type) {
  if (type === '支委会') {
    return { speakers: committeeSpeakers, normalWords: [110, 130], lastSpeakerWords: [200, 250] };
  }
  if (type === '党日活动') {
    return { speakers: partyDaySpeakers, normalWords: [110, 130], lastSpeakerWords: [200, 250] };
  }
  return { speakers: memberSpeakers, normalWords: [110, 130], lastSpeakerWords: [200, 250] };
}

export function isLearningTopic(topic) {
  return /学习|传达|贯彻|第一议题|集中学习|观看|党课|教育|研讨|交流/.test(topic || '');
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function rotateSpeakers(speakers, start, count) {
  if (!speakers.length) return [];
  const selected = [];
  for (let offset = 0; offset < count; offset += 1) {
    selected.push(speakers[(start + offset) % speakers.length]);
  }
  return unique(selected);
}

function withSummarySpeaker(speakers, summarySpeaker = '黄瑞敏', preferSummarySpeaker = false) {
  if (preferSummarySpeaker && speakers.length && !speakers.includes(summarySpeaker)) {
    return [...speakers.slice(0, -1), summarySpeaker];
  }
  if (!speakers.includes(summarySpeaker)) return speakers;
  const selected = speakers.filter((speaker) => speaker !== summarySpeaker);
  return [...selected, summarySpeaker];
}

export function sectionPlanFor(meeting) {
  const type = inferMeetingType(meeting);
  const plan = speakerPlanFor(type);
  const topics = meeting.topics?.length ? meeting.topics : ['围绕台账所列议题开展学习研讨'];
  let cursor = 0;
  let summarySpeakerMisses = 0;

  return topics.map((topic, index) => {
    const learning = isLearningTopic(topic);
    let speakers;
    if (learning && index === 0) {
      speakers = plan.speakers;
    } else if (learning) {
      const count = Math.max(Math.ceil(plan.speakers.length * 0.7), Math.min(plan.speakers.length, 4));
      speakers = rotateSpeakers(plan.speakers, cursor, count);
      cursor += count;
    } else {
      const count = Math.min(plan.speakers.length, type === '党员会' ? 4 : 3);
      speakers = rotateSpeakers(plan.speakers, cursor, count);
      cursor += count;
    }

    const preferSummarySpeaker = !learning && summarySpeakerMisses >= 2;
    const orderedSpeakers = withSummarySpeaker(speakers, '黄瑞敏', preferSummarySpeaker);
    if (orderedSpeakers.includes('黄瑞敏')) {
      if (preferSummarySpeaker) summarySpeakerMisses = 0;
    } else {
      summarySpeakerMisses += 1;
    }

    return {
      heading: `${chineseNumber(index + 1)}、${topic}`,
      topic,
      learning,
      speakers: orderedSpeakers,
      lastSpeaker: orderedSpeakers.at(-1),
      normalWords: plan.normalWords,
      lastSpeakerWords: plan.lastSpeakerWords
    };
  });
}

export function buildFilename(meeting) {
  const type = inferMeetingType(meeting);
  if (type === '支委会') return `${meeting.dateText}支委会会议记录.docx`;
  if (type === '党日活动') return `${meeting.dateText}主题党日活动记录.docx`;
  return `${meeting.dateText}党员会会议记录.docx`;
}

export function titleFor(meeting) {
  const type = inferMeetingType(meeting);
  if (type === '支委会') return `${meeting.dateText}支委会会议记录`;
  if (type === '党日活动') return `${meeting.dateText}主题党日活动记录`;
  return `${meeting.dateText}党员会会议记录`;
}
