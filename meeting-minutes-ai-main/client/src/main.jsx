import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const api = (path) => `/api${path}`;

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function PreviewState({ busy, selected }) {
  if (busy) {
    return (
      <div className="empty loading">
        <div className="spinner" />
        <strong>{busy}</strong>
        <span>正在根据台账议题生成发言稿</span>
      </div>
    );
  }
  return <div className="empty">{selected ? '点击生成，预览将在这里展示。' : '上传标准格式xlsx后开始生成。'}</div>;
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

function RecordPreview({ record, busy, selected }) {
  if (!record) return <PreviewState busy={busy} selected={selected} />;
  return (
    <article className="preview">
      <h2>{record.title}</h2>
      {(record.sections || []).map((section, index) => (
        <section key={index}>
          <h3>{section.heading}</h3>
          {speechesForSection(record, section, index).map((speech, speechIndex) => (
            <div className="speechBlock" key={speechIndex}>
              <p className="speakerName"><strong>{speech.speaker}：</strong></p>
              <p>{speech.content}</p>
            </div>
          ))}
        </section>
      ))}
    </article>
  );
}

function App() {
  const [meetings, setMeetings] = useState([]);
  const [records, setRecords] = useState({});
  const [selectedId, setSelectedId] = useState('');
  const [busyById, setBusyById] = useState({});
  const [exportSelection, setExportSelection] = useState({});
  const [error, setError] = useState('');
  const [revision, setRevision] = useState('');

  const selected = useMemo(() => meetings.find((item) => item.id === selectedId), [meetings, selectedId]);
  const currentRecord = selected ? records[selected.id]?.record : null;
  const selectedBusy = selected ? busyById[selected.id] : '';
  const generatedIds = useMemo(
    () => meetings.filter((meeting) => Boolean(records[meeting.id]?.record)).map((meeting) => meeting.id),
    [meetings, records]
  );
  const selectedExportIds = useMemo(
    () => Object.keys(exportSelection).filter((id) => exportSelection[id]),
    [exportSelection]
  );
  const selectedExportGeneratedIds = useMemo(
    () => selectedExportIds.filter((id) => Boolean(records[id]?.record)),
    [selectedExportIds, records]
  );
  const allGeneratedSelected = useMemo(
    () => generatedIds.length > 0 && generatedIds.every((id) => exportSelection[id]),
    [generatedIds, exportSelection]
  );

  async function readJson(response) {
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`后端返回了非 JSON 内容，请确认 Express 后端已启动在 3001 端口。HTTP ${response.status}`);
      }
    }
    if (!response.ok) throw new Error(data?.error || `请求失败：HTTP ${response.status}`);
    if (!data) throw new Error('后端没有返回内容，请确认 Express 后端已启动在 3001 端口。');
    return data;
  }

  function markBusy(id, message) {
    setBusyById((prev) => ({ ...prev, [id]: message }));
  }

  function clearBusy(id) {
    setBusyById((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function uploadLedger(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const data = await fetch(api('/upload-ledger'), { method: 'POST', body: form }).then(readJson);
      setMeetings(data.meetings);
      setSelectedId(data.meetings[0]?.id || '');
      setRecords({});
      setBusyById({});
      setExportSelection({});
    } catch (err) {
      setError(err.message);
    }
  }

  async function generate(meeting, alreadyMarked = false) {
    if (!alreadyMarked) markBusy(meeting.id, `正在生成 ${meeting.dateText}`);
    setError('');
    try {
      const data = await fetch(api('/generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting })
      }).then(readJson);
      setRecords((prev) => ({ ...prev, [meeting.id]: data }));
      setExportSelection((prev) => ({ ...prev, [meeting.id]: true }));
    } catch (err) {
      setError(`${meeting.dateText}：${err.message}`);
    } finally {
      clearBusy(meeting.id);
    }
  }

  async function generateAll() {
    const pending = meetings.filter((meeting) => !records[meeting.id]?.record && !busyById[meeting.id]);
    for (const meeting of pending) markBusy(meeting.id, `正在生成 ${meeting.dateText}`);
    for (const meeting of pending) await generate(meeting, true);
  }

  async function revise() {
    if (!selected || !currentRecord || !revision.trim()) return;
    markBusy(selected.id, '正在修改发言稿');
    setError('');
    try {
      const data = await fetch(api('/revise'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting: selected, record: currentRecord, instruction: revision })
      }).then(readJson);
      setRecords((prev) => ({ ...prev, [selected.id]: data }));
      setRevision('');
    } catch (err) {
      setError(err.message);
    } finally {
      clearBusy(selected.id);
    }
  }

  async function exportOne(meeting, record) {
    const response = await fetch(api('/export-docx'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meeting, record })
    });
    if (!response.ok) {
      const data = await response.json();
      setError(data.error || '导出失败');
      return;
    }
    downloadBlob(await response.blob(), records[meeting.id]?.filename || `${meeting.dateText}会议记录.docx`);
  }

  async function exportZip() {
    if (!selectedExportIds.length) {
      setError('请先勾选需要导出的会议记录。');
      return;
    }

    const selectedMeetings = meetings.filter((meeting) => selectedExportIds.includes(meeting.id));
    const missing = selectedMeetings.filter((meeting) => !records[meeting.id]?.record);
    if (missing.length) {
      const label = missing.slice(0, 3).map((meeting) => meeting.dateText || meeting.id).join('、');
      setError(`有 ${missing.length} 条会议记录尚未生成（例如：${label}），请先生成后再导出。`);
      return;
    }

    const items = selectedMeetings.map((meeting) => ({ meeting, record: records[meeting.id].record }));
    const response = await fetch(api('/export-zip'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items })
    });
    if (!response.ok) {
      const data = await response.json();
      setError(data.error || '打包失败');
      return;
    }
    downloadBlob(await response.blob(), '会议记录批量导出.zip');
  }

  function toggleExportSelection(meetingId) {
    setExportSelection((prev) => ({ ...prev, [meetingId]: !prev[meetingId] }));
  }

  function toggleSelectAllGenerated() {
    if (allGeneratedSelected) {
      setExportSelection({});
      return;
    }
    setExportSelection((prev) => {
      const next = { ...prev };
      for (const id of generatedIds) next[id] = true;
      return next;
    });
  }

  return (
    <main>
      <aside>
        <div className="brand">
          <span>党支部会议记录生成工具</span>
          <strong>会议记录智能拟稿</strong>
        </div>
        <label className="upload">
          <input type="file" accept=".xlsx" onChange={uploadLedger} />
          上传标准格式xlsx
        </label>
        <button onClick={generateAll} disabled={!meetings.length}>一键生成</button>
        <button onClick={toggleSelectAllGenerated} disabled={!generatedIds.length}>
          {allGeneratedSelected ? '清空勾选' : '全选已生成'}
        </button>
        <button onClick={exportZip} disabled={!selectedExportGeneratedIds.length}>
          批量导出docx（已选{selectedExportGeneratedIds.length}）
        </button>
        {error && <p className="error">{error}</p>}
        <div className="list">
          {meetings.map((meeting) => {
            const hasRecord = Boolean(records[meeting.id]?.record);
            const checked = Boolean(exportSelection[meeting.id]);
            return (
              <div className={meeting.id === selectedId ? 'active row rowItem' : 'row rowItem'} key={meeting.id}>
                <input
                  className="rowCheck"
                  type="checkbox"
                  checked={checked}
                  disabled={!hasRecord}
                  onChange={() => toggleExportSelection(meeting.id)}
                />
                <button className="rowBody" type="button" onClick={() => setSelectedId(meeting.id)}>
                  <span>{meeting.dateText || '未填日期'}</span>
                  <small>{busyById[meeting.id] || `${meeting.category} · ${meeting.topics[0]}`}</small>
                </button>
              </div>
            );
          })}
        </div>
      </aside>
      <section className="workspace">
        {selected ? (
          <>
            <header className="toolbar">
              <div>
                <h1>{selected.dateText} {selected.category}</h1>
                <p>{selected.location} · {selected.topics.join(' / ')}</p>
              </div>
              <div className="actions">
                <button disabled={Boolean(selectedBusy)} onClick={() => generate(selected)}>生成</button>
                <button disabled={!currentRecord} onClick={() => exportOne(selected, currentRecord)}>导出docx</button>
              </div>
            </header>
            <div className="documentPane">
              <RecordPreview record={currentRecord} busy={selectedBusy} selected={selected} />
            </div>
            <div className="revision">
              <textarea value={revision} onChange={(event) => setRevision(event.target.value)} placeholder="输入修改意见，例如：把发言写得更贴合基金会业务，减少空话。" />
              <button disabled={!currentRecord || !revision.trim() || Boolean(selectedBusy)} onClick={revise}>按意见修改</button>
            </div>
          </>
        ) : (
          <div className="welcome">
            <h1>上传标准格式xlsx后开始生成</h1>
            <p>系统已内置素材风格规则，会按每一行会议生成完整发言稿预览，并支持继续修改与导出 Word。</p>
          </div>
        )}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
