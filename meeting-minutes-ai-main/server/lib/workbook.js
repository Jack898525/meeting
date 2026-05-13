import path from 'node:path';
import ExcelJS from 'exceljs';

const columns = {
  category: '\u4f1a\u8bae\u7c7b\u522b',
  dateText: '\u4f1a\u8bae\u65f6\u95f4',
  location: '\u4f1a\u8bae\u5730\u70b9',
  topics: '\u4f1a\u8bae\u8bae\u9898',
  photo: '\u4f1a\u8bae\u76f8\u7247',
  done: '\u4f1a\u8bae\u8bb0\u5f55\u662f\u5426\u5b8c\u6210',
  note: '\u5907\u6ce8',
  templateHint: '\u6587\u4ef6'
};

function cellText(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toLocaleDateString('zh-CN');
  if (typeof value === 'object' && value.text) return cellText(value.text);
  if (typeof value === 'object' && value.richText) return value.richText.map((part) => part.text).join('').trim();
  if (typeof value === 'object' && value.result) return cellText(value.result);
  return String(value).replace(/\r\n/g, '\n').trim();
}

function splitTopics(value) {
  return cellText(value)
    .split(/\n|\/|\uff1b|;/)
    .map((item) => item.replace(/^[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341]+[\u3001.\uff0e]\s*/, '').trim())
    .filter(Boolean);
}

export async function parseWorkbook(filePath) {
  const fullPath = path.resolve(process.cwd(), filePath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(fullPath, { ignoreNodes: ['drawing', 'picture'] });
  const sheet = workbook.worksheets[0];
  const headers = [];

  sheet.getRow(1).eachCell((cell, colNumber) => {
    headers[colNumber] = cellText(cell.value);
  });

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const raw = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      raw[headers[colNumber]] = cell.value;
    });
    rows.push(raw);
  });

  return rows
    .map((row, index) => ({
      id: `m-${index + 1}`,
      category: cellText(row[columns.category]),
      dateText: cellText(row[columns.dateText]),
      location: cellText(row[columns.location]),
      topics: splitTopics(row[columns.topics]),
      photo: cellText(row[columns.photo]),
      done: cellText(row[columns.done]),
      note: cellText(row[columns.note]),
      templateHint: cellText(row[columns.templateHint])
    }))
    .filter((row) => row.category || row.dateText || row.topics.length);
}
