
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

app.post('/process-recording', upload.single('Recording'), async (req, res) => {
    const filePath = req.file.path;

    // Whisper 转文字
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath));
    formData.append('model', 'whisper-1');

    const transcriptRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
        body: formData
    });
    const transcriptJson = await transcriptRes.json();
    const userText = transcriptJson.text;

    // GPT 回复
    const chatRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: '你是一个智能电话客服助手，请简洁清晰回答客户问题。' },
                { role: 'user', content: userText }
            ]
        })
    });
    const chatJson = await chatRes.json();
    const replyText = chatJson.choices[0].message.content;

    // ElevenLabs 合成语音
    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
        method: 'POST',
        headers: {
            'xi-api-key': ELEVENLABS_API_KEY,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            text: replyText,
            model_id: "eleven_monolingual_v1",
            voice_settings: { stability: 0.5, similarity_boost: 0.5 }
        })
    });

    const mp3Buffer = await ttsRes.buffer();
    const outputPath = path.join(__dirname, 'public', 'reply.mp3');
    fs.writeFileSync(outputPath, mp3Buffer);

    res.redirect('/voice'); // 自动继续通话
});

app.post('/voice', (req, res) => {
    const twiml = `
        <Response>
            <Play>https://${req.headers.host}/reply.mp3</Play>
            <Record action="/process-recording" method="POST" maxLength="10" playBeep="true" />
        </Response>
    `;
    res.type('text/xml');
    res.send(twiml);
});

app.use('/reply.mp3', express.static(path.join(__dirname, 'public', 'reply.mp3')));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`✅ AI Voice Server running on port ${PORT}`);
});
