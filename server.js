    import express from 'express';
    import bodyParser from 'body-parser';
    import multer from 'multer';
    import fs from 'fs';
    import path from 'path';
    import FormData from 'form-data';
    import fetch from 'node-fetch';
    import { fileURLToPath } from 'url';

    // ESM __dirname workaround
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    const app = express();
    const upload = multer({ dest: 'uploads/' });

    app.use(bodyParser.urlencoded({ extended: false }));
    app.use(bodyParser.json());

    // 环境变量
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
    const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;

    // 环境变量检查
    const requiredEnvVars = [
        { name: 'OPENAI_API_KEY', value: OPENAI_API_KEY },
        { name: 'ELEVENLABS_API_KEY', value: ELEVENLABS_API_KEY },
        { name: 'ELEVENLABS_VOICE_ID', value: ELEVENLABS_VOICE_ID }
    ];
    requiredEnvVars.forEach(env => {
        if (!env.value) {
            console.error(`❌ 缺少必要环境变量: ${env.name}`);
            console.error('请设置所有必要的环境变量后重启服务');
            process.exit(1);
        }
    });

    const publicDir = path.join(__dirname, 'public');
    const uploadsDir = path.join(__dirname, 'uploads');

    // 确保目录存在
    [publicDir, uploadsDir].forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`📁 创建目录: ${path.basename(dir)}`);
        }
    });

    // 定期清理旧音频文件
    setInterval(() => {
        try {
            const files = fs.readdirSync(publicDir);
            const now = Date.now();
            files.forEach(file => {
                if (file.startsWith('reply-') && file.endsWith('.mp3')) {
                    const filePath = path.join(publicDir, file);
                    const stats = fs.statSync(filePath);
                    if (now - stats.mtime.getTime() > 5 * 60 * 1000) {
                        fs.unlinkSync(filePath);
                        console.log(`🗑️ 清理过期音频: ${file}`);
                    }
                }
            });
        } catch (error) {
            console.error('清理文件时出错:', error);
        }
    }, 2 * 60 * 1000);

    // 主页状态
    app.get('/', (req, res) => {
        const audioFiles = fs.readdirSync(publicDir).filter(f => f.endsWith('.mp3'));
        res.send(\`
            <!DOCTYPE html>
            <html>
            <head>
                <title>AI 电话助手 - 企业版</title>
                <meta charset="utf-8">
            </head>
            <body>
                <h1>🤖 AI 电话助手 - 企业版</h1>
                <p>服务运行正常。</p>
                <p>Twilio Webhook URL: <code>https://\${req.headers.host}/voice</code></p>
                <p>活跃音频文件: \${audioFiles.length}</p>
            </body>
            </html>
        \`);
    });

    // Twilio 语音 webhook
    app.post('/voice', (req, res) => {
        console.log('📞 收到 Twilio 通话');
        res.type('text/xml').send(\`
            <Response>
                <Say voice="Polly.Joanna">Hello! I am your AI assistant. Please speak after the beep.</Say>
                <Record action="/process-recording" method="POST" maxLength="10" playBeep="true" />
            </Response>
        \`);
    });

    // 处理录音
    app.post('/process-recording', upload.single('Recording'), async (req, res) => {
        const startTime = Date.now();
        let filePath = null;
        try {
            if (!req.file) throw new Error('未收到录音文件');
            filePath = req.file.path;
            console.log(\`📁 录音文件: \${path.basename(filePath)}\`);

            // Whisper
            const userText = await transcribeWithWhisper(filePath);
            console.log('🔊 识别内容:', userText);

            if (!userText || !userText.trim()) throw new Error('转录结果为空');

            // GPT
            const replyText = await chatWithGPT(userText);
            console.log('🤖 GPT 回复:', replyText);

            // ElevenLabs
            const fileName = await synthesizeWithElevenLabs(replyText);

            const processingTime = Date.now() - startTime;
            console.log(\`✅ 处理完成 (耗时: \${processingTime}ms)\`);

            // 清理上传文件
            if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);

            res.type('text/xml').send(\`
                <Response>
                    <Play>https://\${req.headers.host}/audio/\${fileName}</Play>
                    <Record action="/process-recording" method="POST" maxLength="10" playBeep="true" />
                </Response>
            \`);
        } catch (error) {
            console.error('❌ 处理失败:', error.message);
            if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
            res.type('text/xml').send(\`
                <Response>
                    <Say voice="Polly.Joanna">Sorry, I had trouble processing your message. Please try again.</Say>
                    <Record action="/process-recording" method="POST" maxLength="10" playBeep="true" />
                </Response>
            \`);
        }
    });

    // 音频文件服务
    app.get('/audio/:filename', (req, res) => {
        const filename = req.params.filename;
        const filePath = path.join(publicDir, filename);
        if (fs.existsSync(filePath)) {
            res.set({
                'Content-Type': 'audio/mpeg',
                'Cache-Control': 'no-cache'
            });
            res.sendFile(filePath);
        } else {
            res.status(404).json({ error: 'Audio not found' });
        }
    });

    // 健康检查
    app.get('/health', (req, res) => {
        const uptime = process.uptime();
        res.json({
            status: 'healthy',
            uptime: \`\${Math.floor(uptime)}s\`,
            timestamp: new Date().toISOString()
        });
    });

    // Whisper
    async function transcribeWithWhisper(filePath) {
        const formData = new FormData();
        formData.append('file', fs.createReadStream(filePath));
        formData.append('model', 'whisper-1');

        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
                'Authorization': \`Bearer \${OPENAI_API_KEY}\`,
                ...formData.getHeaders()
            },
            body: formData
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(\`Whisper API 调用失败: \${response.status} - \${errText}\`);
        }

        const result = await response.json();
        if (!result.text) throw new Error('Whisper 返回空转录');
        return result.text;
    }

    // GPT
    async function chatWithGPT(userText) {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': \`Bearer \${OPENAI_API_KEY}\`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-4',
                messages: [
                    { role: 'system', content: '你是一个友好的 AI 电话助手，用简短自然的中文回答问题。' },
                    { role: 'user', content: userText }
                ],
                max_tokens: 100,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(\`ChatGPT API 调用失败: \${response.status} - \${errText}\`);
        }

        const result = await response.json();
        if (!result.choices?.[0]?.message?.content) throw new Error('ChatGPT 返回空回复');
        return result.choices[0].message.content;
    }

    // ElevenLabs
    async function synthesizeWithElevenLabs(text) {
        const response = await fetch(\`https://api.elevenlabs.io/v1/text-to-speech/\${ELEVENLABS_VOICE_ID}\`, {
            method: 'POST',
            headers: {
                'xi-api-key': ELEVENLABS_API_KEY,
                'Content-Type': 'application/json',
                'Accept': 'audio/mpeg'
            },
            body: JSON.stringify({
                text,
                model_id: 'eleven_multilingual_v2'
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(\`ElevenLabs 语音合成失败: \${response.status} - \${errText}\`);
        }

        const buffer = await response.arrayBuffer();
        const fileName = \`reply-\${Date.now()}-\${Math.random().toString(36).slice(2, 8)}.mp3\`;
        const filePath = path.join(publicDir, fileName);
        fs.writeFileSync(filePath, Buffer.from(buffer));
        return fileName;
    }

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(\`
🚀 AI 电话助手启动成功！
🌐 访问: http://localhost:\${PORT}
📡 Twilio Webhook: /voice
        \`);
    });
