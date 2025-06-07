const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const fetch = require('node-fetch');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;

const publicDir = path.join(__dirname, 'public');
const uploadsDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>AI 电话助手</title>
            <meta charset="utf-8">
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
                .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                .status { padding: 15px; border-radius: 8px; margin: 15px 0; }
                .success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
                .warning { background: #fff3cd; color: #856404; border: 1px solid #ffeaa7; }
                .info { background: #d1ecf1; color: #0c5460; border: 1px solid #bee5eb; }
                code { background: #f8f9fa; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
                ul { list-style-type: none; padding: 0; }
                li { padding: 8px 0; border-bottom: 1px solid #eee; }
                .emoji { font-size: 1.2em; margin-right: 8px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🤖 AI 电话助手</h1>
                <div class="status success">
                    <span class="emoji">✅</span>服务运行正常
                </div>
                
                <div class="status info">
                    <strong>📞 Twilio Webhook URL:</strong><br>
                    <code>https://${req.headers.host}/voice</code>
                </div>
                
                <h3>📋 系统状态</h3>
                <ul>
                    <li><span class="emoji">${OPENAI_API_KEY ? '✅' : '❌'}</span>OpenAI API: ${OPENAI_API_KEY ? '已配置' : '未配置'}</li>
                    <li><span class="emoji">${ELEVENLABS_API_KEY ? '✅' : '❌'}</span>ElevenLabs API: ${ELEVENLABS_API_KEY ? '已配置' : '未配置'}</li>
                    <li><span class="emoji">${ELEVENLABS_VOICE_ID ? '✅' : '❌'}</span>Voice ID: ${ELEVENLABS_VOICE_ID ? '已配置' : '未配置'}</li>
                    <li><span class="emoji">${fs.existsSync(path.join(publicDir, 'reply.mp3')) ? '✅' : '⏳'}</span>回复音频: ${fs.existsSync(path.join(publicDir, 'reply.mp3')) ? '已生成' : '等待生成'}</li>
                </ul>
                
                ${!OPENAI_API_KEY || !ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID ? 
                    '<div class="status warning"><span class="emoji">⚠️</span>请检查环境变量配置</div>' : 
                    '<div class="status success"><span class="emoji">🎉</span>所有配置正常，准备接收通话</div>'}
                
                <h3>🔗 测试端点</h3>
                <ul>
                    <li><a href="/health">📊 健康检查 (JSON)</a></li>
                    <li><a href="/reply.mp3">🎵 当前回复音频</a></li>
                </ul>
                
                <div class="status info">
                    <small>
                        <strong>部署时间:</strong> ${new Date().toLocaleString('zh-CN')}<br>
                        <strong>Node.js:</strong> ${process.version}
                    </small>
                </div>
            </div>
        </body>
        </html>
    `);
});

app.post('/process-recording', upload.single('Recording'), async (req, res) => {
    const startTime = Date.now();
    let filePath = null;
    
    try {
        console.log('🎯 开始处理录音...');
        
        if (!req.file) {
            throw new Error('未收到录音文件');
        }
        
        filePath = req.file.path;
        console.log(`📁 录音文件: ${path.basename(filePath)} (${req.file.size} bytes)`);

        // 步骤 1: Whisper 转录
        console.log('🎙️ 开始 Whisper 转录...');
        const userText = await transcribeWithWhisper(filePath);
        console.log(`🔊 识别内容: "${userText}"`);
        
        // 验证转录结果
        if (!userText || userText.trim().length === 0) {
            throw new Error('转录结果为空，可能是静音或音频质量问题');
        }
        
        if (userText.trim().length < 2) {
            console.log('⚠️ 转录结果过短，可能是噪音');
        }

        // 步骤 2: GPT 生成回复
        console.log('🧠 开始 GPT 生成回复...');
        const replyText = await chatWithGPT(userText);
        console.log(`🤖 GPT 回复: "${replyText}"`);

        // 步骤 3: ElevenLabs 语音合成
        console.log('🔊 开始 ElevenLabs 语音合成...');
        await synthesizeWithElevenLabs(replyText);
        
        const processingTime = Date.now() - startTime;
        console.log(`✅ 处理完成 (耗时: ${processingTime}ms)`);

        // 延迟清理文件，避免竞态条件
        setTimeout(() => {
            if (filePath && fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log('🗑️ 清理临时文件');
            }
        }, 1000);

        res.redirect('/voice');
        
    } catch (error) {
        const processingTime = Date.now() - startTime;
        console.error(`❌ 处理失败 (耗时: ${processingTime}ms):`, error.message);
        
        // 立即清理文件
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log('🗑️ 清理失败的临时文件');
        }
        
        res.type('text/xml').send(`
            <Response>
                <Say voice="Polly.Joanna">Sorry, I had trouble processing your message. Please try speaking more clearly.</Say>
                <Record action="/process-recording" method="POST" maxLength="10" playBeep="true" />
            </Response>
        `);
    }
});

app.post('/voice', (req, res) => {
    console.log('📞 收到 Twilio 通话');
    const replyPath = path.join(publicDir, 'reply.mp3');
    
    if (fs.existsSync(replyPath)) {
        console.log('🔊 播放 AI 回复');
        res.type('text/xml').send(`
            <Response>
                <Play>https://${req.headers.host}/reply.mp3</Play>
                <Record action="/process-recording" method="POST" maxLength="10" playBeep="true" />
            </Response>
        `);
    } else {
        console.log('🎙️ 首次通话，播放欢迎语');
        res.type('text/xml').send(`
            <Response>
                <Say voice="Polly.Joanna">Hello! I am your AI assistant. Please speak after the beep.</Say>
                <Record action="/process-recording" method="POST" maxLength="10" playBeep="true" />
            </Response>
        `);
    }
});

app.get('/reply.mp3', (req, res) => {
    const replyPath = path.join(publicDir, 'reply.mp3');
    if (fs.existsSync(replyPath)) {
        console.log('📤 发送回复音频');
        res.set({
            'Content-Type': 'audio/mpeg',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        res.sendFile(replyPath);
    } else {
        console.log('❌ 回复音频文件不存在');
        res.status(404).json({ 
            error: 'Audio not ready',
            message: '回复音频尚未生成，请稍后重试'
        });
    }
});

async function transcribeWithWhisper(filePath) {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath));
    formData.append('model', 'whisper-1');
    formData.append('language', 'auto');
    
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            ...formData.getHeaders()
        },
        body: formData
    });
    
    if (!response.ok) { 
        const errText = await response.text(); 
        throw new Error(`Whisper API 调用失败: ${response.status} - ${errText}`); 
    }
    
    const result = await response.json();
    return result.text;
}

async function chatWithGPT(userText) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'gpt-4',
            messages: [
                { 
                    role: 'system', 
                    content: '你是一个友好的AI电话助手。请用简洁、自然、口语化的中文回答客户问题。回复要简短（30字以内），适合电话对话，语气要亲切友好。' 
                },
                { 
                    role: 'user', 
                    content: userText 
                }
            ],
            max_tokens: 100,
            temperature: 0.7
        })
    });
    
    if (!response.ok) { 
        const errText = await response.text(); 
        throw new Error(`ChatGPT API 调用失败: ${response.status} - ${errText}`); 
    }
    
    const result = await response.json();
    return result.choices[0].message.content;
}

async function synthesizeWithElevenLabs(text) {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
        method: 'POST',
        headers: {
            'xi-api-key': ELEVENLABS_API_KEY,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg'
        },
        body: JSON.stringify({ 
            text, 
            model_id: "eleven_multilingual_v2",
            voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
                style: 0.0,
                use_speaker_boost: true
            }
        })
    });
    
    if (!response.ok) { 
        const errText = await response.text(); 
        throw new Error(`ElevenLabs 语音合成失败: ${response.status} - ${errText}`); 
    }
    
    const buffer = await response.buffer();
    fs.writeFileSync(path.join(publicDir, 'reply.mp3'), buffer);
    console.log('💾 音频文件已保存');
}

app.get('/health', (req, res) => {
    const replyExists = fs.existsSync(path.join(publicDir, 'reply.mp3'));
    const uptime = process.uptime();
    
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: `${Math.floor(uptime / 60)}分${Math.floor(uptime % 60)}秒`,
        environment: {
            openai: !!OPENAI_API_KEY,
            elevenlabs: !!ELEVENLABS_API_KEY,
            voice_id: !!ELEVENLABS_VOICE_ID,
            node_env: process.env.NODE_ENV || 'development'
        },
        files: {
            public_dir: fs.existsSync(publicDir),
            uploads_dir: fs.existsSync(uploadsDir),
            reply_mp3: replyExists
        },
        memory: {
            used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
            total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB'
        }
    });
});

app.use((error, req, res, next) => {
    console.error('🚨 服务器错误:', error);
    res.status(500).json({ 
        error: '服务器内部错误',
        message: process.env.NODE_ENV === 'development' ? error.message : '请稍后重试'
    });
});

app.use((req, res) => {
    res.status(404).json({ 
        error: '页面未找到',
        message: `路径 ${req.url} 不存在`
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`
🚀 AI 电话助手启动成功！
📡 端口: ${PORT}
🌐 访问: http://localhost:${PORT}
⏰ 启动时间: ${new Date().toLocaleString('zh-CN')}

📋 环境检查:
${OPENAI_API_KEY ? '✅' : '❌'} OPENAI_API_KEY
${ELEVENLABS_API_KEY ? '✅' : '❌'} ELEVENLABS_API_KEY  
${ELEVENLABS_VOICE_ID ? '✅' : '❌'} ELEVENLABS_VOICE_ID

🔗 重要端点:
  POST /voice           - Twilio webhook
  POST /process-recording - 录音处理
  GET  /reply.mp3       - 音频文件
  GET  /health          - 健康检查
    `);
});
