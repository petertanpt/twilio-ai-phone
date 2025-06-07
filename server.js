const express = require('express');
const bodyParser = require('body-parser');
const { twiml } = require('twilio');
const fs = require('fs');
const multer = require('multer');
const FormData = require('form-data');
const fetch = require('node-fetch');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static('public'));

const upload = multer({ dest: 'uploads/' });

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Serve Twilio webhook
app.post('/voice', (req, res) => {
  const response = new twiml.VoiceResponse();
  response.start().stream({ url: 'wss://your-render-app-name.onrender.com/audio' });
  response.say({ voice: 'Polly.Joanna' }, 'Hello, I am your AI assistant, how can I help you today?');
  response.play('https://your-render-app-name.onrender.com/reply.mp3');
  response.pause({ length: 60 });
  res.type('text/xml');
  res.send(response.toString());
});

// Serve reply audio
app.use('/reply.mp3', express.static('reply.mp3'));

// WebSocket 接收音频
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 10000 });

wss.on('connection', function connection(ws) {
  console.log('🔊 WebSocket connected');
  let audioBuffer = [];

  ws.on('message', async function incoming(message) {
    const parsed = JSON.parse(message);
    const event = parsed.event;

    if (event === 'start') {
      console.log('✅ Stream started');
    }

    if (event === 'media') {
      const buffer = Buffer.from(parsed.media.payload, 'base64');
      audioBuffer.push(buffer);
    }

    if (event === 'stop') {
      console.log('🛑 Stream ended');
      const finalAudio = Buffer.concat(audioBuffer);
      fs.writeFileSync('call.ulaw', finalAudio);
      const transcript = await transcribeWithWhisper('call.ulaw');
      console.log('📝 Transcript:', transcript);
      const reply = await chatWithGPT(transcript);
      console.log('🤖 GPT Reply:', reply);
      await generateSpeech(reply);
    }
  });
});

// Whisper API
async function transcribeWithWhisper(filePath) {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  form.append('model', 'whisper-1');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form
  });

  const data = await res.json();
  return data.text;
}

// GPT-4o
async function chatWithGPT(prompt) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: '你是一个简洁有礼貌的AI电话助理，用英文回复客户' },
        { role: 'user', content: prompt }
      ]
    })
  });

  const data = await res.json();
  return data.choices[0].message.content;
}

// ElevenLabs 语音合成
async function generateSpeech(text) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_monolingual_v1',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 }
    })
  });

  const audioBuffer = await res.buffer();
  fs.writeFileSync('reply.mp3', audioBuffer);
}

// Start app
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ AI Voice Server running on port ${PORT}`);
});
