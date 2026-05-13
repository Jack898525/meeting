import { inferMeetingType, sectionPlanFor, titleFor } from './meetingRules.js';

const policyContext = [
  '“八项规定改变中国”发言要围绕中央八项规定精神带来的作风转变展开，可谈密切联系群众、纠治“四风”、厉行节约、制度执行、基层减负、清廉高效、担当作为等角度。',
  '“党建引领业务讨论”发言以党建引领、规范履职、改进作风、服务中心工作为主，使用稳妥泛化表述，不展开台账未提供的具体业务事实。'
].join('\n');

function sectionRulesFor(meeting) {
  return sectionPlanFor(meeting).map((section) => {
    const speakerLines = section.speakers.map((speaker, index) => {
      const words = index === section.speakers.length - 1 ? '200-250字' : '110-130字';
      return `  - ${speaker}：${words}`;
    }).join('\n');
    return [
      `${section.heading}`,
      `议题：${section.topic}`,
      section.learning ? '发言安排：学习类议题，大多数人要发言；如果这是第一项学习类议题，必须安排全部发言人。' : '发言安排：围绕该项任务安排下列人员发言。',
      speakerLines
    ].join('\n');
  }).join('\n\n');
}

export function buildGenerationPrompt({ meeting, styleProfile }) {
  const type = inferMeetingType(meeting);
  const styleHint = styleProfile
    ? `\n素材风格摘要：\n${JSON.stringify(styleProfile.summary || styleProfile, null, 2)}`
    : '';

  return [
    '你是高校基层党支部会议记录拟稿助手。请根据台账信息和历史素材风格，生成一份完整中文会议记录草稿。',
    '必须输出严格 JSON，不要 Markdown，不要代码块。JSON 结构为：{"title": string, "meta": {"time": string, "location": string, "type": string}, "sections": [{"heading": string, "topic": string, "speeches": [{"speaker": string, "theme": string, "content": string}]}], "conclusion": ""}。',
    '不要再输出独立的扁平 speeches 字段；所有实质内容都必须放在对应 sections[i].speeches 中。',
    `会议类型：${type}`,
    `标题：${titleFor(meeting)}`,
    `时间：${meeting.dateText}`,
    `地点：${meeting.location}`,
    `xlsx 台账议题：${(meeting.topics || []).join('；')}`,
    meeting.note ? `备注：${meeting.note}` : '',
    '内容优先级：优先围绕 xlsx 中的议题生成发言；其次灵活结合“八项规定改变中国”和“党建引领业务讨论”。不要脱离台账议题另起主题。',
    '会议记录正文只保留议题标题和交流发言。所有内容都以发言稿形式存在，不要生成独立的会议背景、学习纪要、会议总结等叙述性段落。',
    '发言稿要能直接放进会议记录文件，不要写“可围绕”“建议发言”等提示性语言。',
    '不要在发言内容开头添加两个空格，也不要使用首行缩进符号。',
    '不要编造台账未提供的具体工作事实，不要写成已经开展了某项具体工作、取得了某项具体成效或推进了某个具体事项。',
    '降低“基金会”“校友工作”等实体和业务词出现频率；确需关联时，只使用“结合岗位职责”“服务中心工作”“提升服务质效”“规范履职”“改进作风”等不会出错的泛化表述。',
    '避免使用容易被理解为具体业务事实的表述，不展开具体业务条线、具体事项、具体成果。',
    '每一项议题都必须有 speeches；每一项议题最后一名发言人的 content 必须控制在 200-250 字，并承担该议题的小结提升作用；其他发言人约 110-130 字。',
    '学习类讲话内容大多数人都要发言；第一项学习类议题必须安排全部发言人。',
    'theme 只能填写“八项规定改变中国”或“党建引领业务讨论”。每名发言人在同一议题下只选一个 theme。',
    '下列章节、中文序号、议题和发言人名单必须严格保持，不得新增、删减或改名：',
    sectionRulesFor(meeting),
    policyContext,
    '文风参考高校党支部会议记录，朴实、正式、稳妥。每段发言以学习体会、思想认识、作风建设、纪律要求、支部建设和岗位履责为主。',
    '不要编造参会照片、投票结果、上级领导到场等台账未提供的信息。',
    styleHint
  ].filter(Boolean).join('\n');
}

export function buildRevisionPrompt({ record, instruction }) {
  return [
    '你是高校基层党支部会议记录修订助手。请按用户意见修改会议记录，保持原 JSON 结构。',
    '必须输出严格 JSON，不要 Markdown，不要代码块。',
    '保留 sections[].speeches 结构；除非用户明确要求删除，否则保留每一项议题和每位既有发言人。',
    '每一项议题最后一名发言人的 content 仍需保持 200-250 字左右；发言内容开头不要空两格。',
    `用户修改意见：${instruction}`,
    `原会议记录 JSON：${JSON.stringify(record)}`
  ].join('\n');
}
