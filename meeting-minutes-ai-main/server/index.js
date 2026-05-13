import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { parseWorkbook } from './lib/workbook.js';
import { generateRecord, getApiKey, getBaseURL, getModel, listAvailableModels, reviseRecord } from './lib/ai.js';
import { recordToDocxBuffer, outputFilenameFor } from './lib/docxExport.js';
import { generatedDir, uploadDir } from './lib/paths.js';
import { analyzeMaterials, loadStyleProfile } from './lib/styleProfile.js';

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(generatedDir, { recursive: true });

const app = express();
const upload = multer({ dest: uploadDir });
const records = new Map();
const meetings = new Map();

app.use(cors());
app.use(express.json({ limit: '20mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    hasApiKey: Boolean(getApiKey()),
    model: getModel() || 'auto',
    baseURL: getBaseURL() || 'https://api.openai.com/v1',
    mock: process.env.MOCK_AI === '1'
  });
});

app.get('/api/models', async (_req, res, next) => {
  try {
    res.json({ models: await listAvailableModels() });
  } catch (error) {
    next(error);
  }
});

app.post('/api/analyze-materials', async (_req, res, next) => {
  try {
    res.json(await analyzeMaterials());
  } catch (error) {
    next(error);
  }
});

app.post('/api/upload-ledger', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: '请上传 xlsx 文件。' });
    const parsed = await parseWorkbook(req.file.path);
    for (const meeting of parsed) meetings.set(meeting.id, meeting);
    res.json({ meetings: parsed });
  } catch (error) {
    next(error);
  }
});

app.post('/api/generate', async (req, res, next) => {
  try {
    const meeting = req.body.meeting || meetings.get(req.body.id);
    if (!meeting) return res.status(400).json({ error: '缺少会议数据。' });
    const record = await generateRecord({ meeting, styleProfile: loadStyleProfile() });
    records.set(meeting.id, { meeting, record });
    res.json({ id: meeting.id, record, filename: outputFilenameFor(meeting) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/revise', async (req, res, next) => {
  try {
    const current = req.body.record || records.get(req.body.id)?.record;
    const meeting = req.body.meeting || records.get(req.body.id)?.meeting;
    if (!current || !meeting || !req.body.instruction) {
      return res.status(400).json({ error: '缺少原文、会议数据或修改意见。' });
    }
    const record = await reviseRecord({ record: current, instruction: req.body.instruction });
    records.set(meeting.id, { meeting, record });
    res.json({ id: meeting.id, record, filename: outputFilenameFor(meeting) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/export-docx', async (req, res, next) => {
  try {
    const meeting = req.body.meeting || records.get(req.body.id)?.meeting;
    const record = req.body.record || records.get(req.body.id)?.record;
    if (!meeting || !record) return res.status(400).json({ error: '缺少可导出的会议记录。' });
    const filename = outputFilenameFor(meeting);
    const buffer = await recordToDocxBuffer(record);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

app.post('/api/export-zip', async (req, res, next) => {
  try {
    const items = req.body.items || [];
    if (!items.length) return res.status(400).json({ error: '没有可打包的会议记录。' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''meeting-records.zip");
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', next);
    archive.pipe(res);
    for (const item of items) {
      const buffer = await recordToDocxBuffer(item.record);
      archive.append(buffer, { name: outputFilenameFor(item.meeting) });
    }
    await archive.finalize();
  } catch (error) {
    next(error);
  }
});

const clientDist = path.resolve('client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    return res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message || '服务器处理失败。' });
});

const port = Number(process.env.PORT || 3001);
if (process.env.VERCEL !== '1') {
  app.listen(port, () => {
    console.log(`meeting-minutes-ai server listening on http://127.0.0.1:${port}`);
  });
}

export default app;
