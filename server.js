
const express = require('express');
const bodyParser = require('body-parser');
const { twiml } = require('twilio');
const WebSocket = require('ws');
const fs = require('fs');
const fetch = require('node-fetch');
const multer = require('multer');
const FormData = require('form-data');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const upload = multer({ dest: 'uploads/' });

app.post('/voice', (req, res) => {
  const response = new twiml.VoiceResponse();
  response.start().stream({ url: 'wss://ai-phone-server-cwp0.onrender.com/audio' });
  response.say({ voice: 'Polly.Joanna' }, 'Hello, I am your AI assistant, how can I help you today?');
  response.pause({ length: 60 });
  res.type('text/xml');
  res.send(response.toString());
});

const wss = new WebSocket.Server({ port: 10000 });
wss.on('connection', function connection(ws) {
  console.log('🔊 WebSocket connected: receiving Twilio audio stream');
  let audioBuffer = [];

  ws.on('message', async function incoming(message) {
    const parsed = JSON.parse(message);
    const event = parsed.event;

    if (event === 'start') {
      console.log('✅ Stream started from Twilio');
    }

    if (event === 'media') {
      const audioData = parsed.media.payload;
      const buffer = Buffer.from(audioData, 'base64');
      audioBuffer.push(buffer);
    }

    if (event === 'stop') {
      console.log('🛑 Stream ended');
      const finalAudio = Buffer.concat(audioBuffer);
      fs.writeFileSync('call.ulaw', finalAudio);

      const transcript = await transcribeWithWhisper('call.ulaw');
      console.log('📝 AI识别结果：', transcript);

      const reply = await chatWithGPT(transcript);
      console.log('🤖 GPT 回复：', reply);

      const audioUrl = await synthesizeWithElevenLabs(reply);
      console.log('🔊 ElevenLabs 音频地址：', audioUrl);
    }
  });
});

async function transcribeWithWhisper(filePath) {
  const formData = new FormData();
  formData.append('file', fs.createReadStream(filePath));
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'text');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: formData
  });

  return await response.text();
}

async function chatWithGPT(text) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: '你是一个电话语音助手，请简洁清晰回答客户问题。' },
        { role: 'user', content: text }
      ]
    })
  });

  const data = await res.json();
  return data.choices[0].message.content;
}

async function synthesizeWithElevenLabs(text) {
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_monolingual_v1',
      voice_settings: { stability: 0.4, similarity_boost: 0.8 }
    })
  });

  const buffer = await response.arrayBuffer();
  fs.writeFileSync('reply.mp3', Buffer.from(buffer));
  return 'reply.mp3';
}

app.listen(3000, () => {
  console.log('✅ AI Voice Server running on port 3000');
});
