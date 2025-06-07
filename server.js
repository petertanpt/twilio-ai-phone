import express from 'express';
import bodyParser from 'body-parser';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// 环境变量
const {
  OPENAI_API_KEY,
  ELEVENLABS_API_KEY,
  ELEVENLABS_VOICE_ID,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  PORT = 3000
} = process.env;

// 必要环境变量检查
for (const [key, val] of Object.entries({
  OPENAI_API_KEY,
  ELEVENLABS_API_KEY,
  ELEVENLABS_VOICE_ID,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN
})) {
  if (!val) {
    console.error(`❌ 缺少环境变量: ${key}`);
    process.exit(1);
  }
}

const publicDir = path.join(__dirname, 'public');
const uploadsDir = path.join(__dirname, 'uploads');
await fs.mkdir(publicDir, { recursive: true });
await fs.mkdir(uploadsDir, { recursive: true });

/* 定期清理 30 分钟前的音频，每 10 分钟执行一次 */
setInterval(async () => {
  try {
    const files = await fs.readdir(publicDir);
    const now = Date.now();
    for (const file of files) {
      if (file.startsWith('reply-') && file.endsWith('.mp3')) {
        const stat = await fs.stat(path.join(publicDir, file));
        if (now - stat.mtimeMs > 30 * 60 * 1000) {
          await fs.unlink(path.join(publicDir, file));
          console.log('🗑️ 删除过期音频', file);
        }
      }
    }
  } catch (err) {
    console.error('清理任务错误:', err.message);
  }
}, 10 * 60 * 1000);

/* 首页 */
app.get('/', async (req, res) => {
  const audioFiles = (await fs.readdir(publicDir)).filter(f => f.endsWith('.mp3'));
  res.send(`
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"><title>AI 电话助手</title>
    <style>
      body{font-family:Arial;margin:40px;background:#f5f5f5}
      .container{max-width:600px;margin:auto;background:#fff;padding:30px;border-radius:10px;box-shadow:0 2px 10px rgba(0,0,0,.1)}
      .status{background:#d4edda;color:#155724;padding:15px;border-radius:5px;margin:10px 0}
      code{background:#f8f9fa;padding:2px 6px;border-radius:3px}
    </style></head>
    <body><div class="container">
      <h1>🤖 AI 电话助手</h1>
      <div class="status">✅ 服务运行正常</div>
      <p><strong>Webhook:</strong><br><code>https://${req.headers.host}/voice</code></p>
      <p><strong>活跃音频文件:</strong> ${audioFiles.length}</p>
      <p><a href="/health">📊 健康检查</a></p>
    </div></body></html>
  `);
});

/* Twilio 接入点 */
app.post('/voice', (req, res) => {
  res.type('text/xml').send(`
    <Response>
      <Say voice="Polly.Joanna">您好！我是AI助手，听到提示音后请讲话。</Say>
      <Record action="/process-recording" method="POST" maxLength="10" playBeep="true" />
    </Response>
  `);
});

/* 处理录音 */
app.post('/process-recording', async (req, res) => {
  let tempFile = null;
  try {
    console.log('📥 req.body keys:', Object.keys(req.body));
    console.log('📥 req.file:', req.file);

    /* 1. 判断录音来源 */
    let localPath;
    if (req.file) {
      localPath = req.file.path;
      console.log('📂 使用上传文件:', localPath);
    } else {
      const { RecordingUrl } = req.body;
      if (!RecordingUrl) throw new Error('Twilio 未返回 RecordingUrl');
      console.log('🔗 RecordingUrl:', RecordingUrl);

      const audioRes = await fetch(`${RecordingUrl}.wav`, {
        headers: {
          Authorization:
            'Basic ' +
            Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')
        }
      });
      if (!audioRes.ok) throw new Error(`下载录音失败: ${audioRes.status}`);
      const buf = Buffer.from(await audioRes.arrayBuffer());

      tempFile = path.join(uploadsDir, `tw-${Date.now()}.wav`);
      await fs.writeFile(tempFile, buf);
      localPath = tempFile;
    }

    /* 2. Whisper 转写 */
    const userText = await transcribeWithWhisper(localPath);
    if (!userText || userText.trim().length < 3) throw new Error('转录过短');
    console.log('🔊 识别:', userText);

    /* 3. GPT 回复 */
    const replyText = await chatWithGPT(userText);
    console.log('🤖 GPT 回复:', replyText);

    /* 4. ElevenLabs 合成语音 */
    const audioName = await synthesizeWithElevenLabs(replyText);

    res.type('text/xml').send(`
      <Response>
        <Play>https://${req.headers.host}/audio/${audioName}</Play>
        <Record action="/process-recording" method="POST" maxLength="10" playBeep="true" />
      </Response>
    `);
  } catch (err) {
    console.error('❌ 处理失败:', err.message);
    res.type('text/xml').send(`
      <Response>
        <Say voice="Polly.Joanna">抱歉，处理您的消息时遇到问题，请重试。</Say>
        <Record action="/process-recording" method="POST" maxLength="10" playBeep="true" />
      </Response>
    `);
  } finally {
    if (tempFile) await fs.unlink(tempFile).catch(() => {});
  }
});

/* 音频服务 */
app.get('/audio/:file', async (req, res) => {
  const filePath = path.join(publicDir, req.params.file);
  try {
    await fs.access(filePath);
    res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-cache' });
    res.sendFile(filePath);
  } catch {
    res.status(404).json({ error: 'audio not found' });
  }
});

/* 健康检查 */
app.get('/health', async (_req, res) => {
  const files = (await fs.readdir(publicDir)).filter(f => f.endsWith('.mp3'));
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    audio_files: files.length
  });
});

/* --- Helper Functions --- */

async function transcribeWithWhisper(filePath) {
  const formData = new FormData();
  formData.append('file', fsSync.createReadStream(filePath));
  formData.append('model', 'whisper-1');

  const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, ...formData.getHeaders() },
    body: formData
  });
  if (!resp.ok) throw new Error(`Whisper 失败: ${resp.status}`);
  const { text } = await resp.json();
  return text;
}

async function chatWithGPT(text) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: '你是一个友好的中文电话助手，回复≤30字。' },
        { role: 'user', content: text }
      ],
      max_tokens: 60,
      temperature: 0.7
    })
  });
  if (!resp.ok) throw new Error(`GPT 失败: ${resp.status}`);
  const data = await resp.json();
  return data.choices[0].message.content;
}

async function synthesizeWithElevenLabs(text) {
  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg'
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.7,
        similarity_boost: 0.8,
        style: 0.2,
        use_speaker_boost: true
      }
    })
  });
  if (!resp.ok) throw new Error(`ElevenLabs 失败: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const fileName = `reply-${Date.now()}-${randomUUID().slice(0,8)}.mp3`;
  await fs.writeFile(path.join(publicDir, fileName), buf);
  return fileName;
}

/* 启动 */
app.listen(PORT, () => console.log(`🚀 Server listening on ${PORT}`));
