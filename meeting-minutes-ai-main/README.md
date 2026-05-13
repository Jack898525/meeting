# 党支部会议记录 AI 生成网页

本项目用于从党组织生活台账 xlsx 批量生成会议记录草稿，支持网页预览、按修改意见二次修订、单份 docx 导出和批量 zip 导出。

## 本地运行

开发调试推荐：

```powershell
npm install
npm run dev
```

访问：

```text
http://127.0.0.1:5174
```

`npm run dev` 会同时启动后端 `3001` 和前端 `5174`。前端已配置 `/api` 代理到后端；如果只单独运行 `npm run client`，上传 xlsx 时会因为后端没启动而失败。

生产构建预览：

```powershell
npm install
npm run analyze
npm run build
npm run server
```

访问：

```text
http://127.0.0.1:3001
```

## 环境变量

复制 `.env.example` 为 `.env`：

```env
OPENAI_API_KEY=你的服务端 API key
OPENAI_MODEL=gpt-5.5
PORT=3001
```

后端不会在代码里内置 API key，请在部署平台配置 `OPENAI_API_KEY`；`OPENAI_MODEL` 可选（不配则自动选择可用模型）。

开发时可加：

```env
MOCK_AI=1
```

`MOCK_AI=1` 会跳过真实 AI 调用，只用于测试上传、预览和 docx 导出链路。正式部署时删除这一行。

## 部署注意

- API key 只能放在服务端环境变量里，不能写入前端代码。
- 用户上传的 xlsx 会由后端解析，当前解析会忽略台账中的图片绘图节点，只读取文字字段。
- 线上部署前建议重新生成 API key。聊天、日志或仓库里出现过的 key 都应视为已泄露。
- 如果部署平台会持久化文件系统，建议定期清理 `uploads/` 和 `generated/`。

## 验证命令

```powershell
npm test
npm run build
npm audit --omit=dev
```
