const express = require('express');
const bodyParser = require('body-parser');
const { twiml } = require('twilio');
const WebSocket = require('ws');
const fs = require('fs');
const axios = require('axios');
const { execSync } = require('child_process');
require('dotenv').config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// Serve Twilio webhook
app.post('/voice', (req, res) => {
  const response = new twiml.VoiceResponse();
  response.start().stream({ url: 'wss://' + req.headers.host + '/audio' });
  response.say({ voice: 'Polly.Joanna', language: 'en-US' }, 'Hello, I am your AI assistant. How can I help you today?');
  res.type('text/xml');
  res.send(response.toString());
});

const PORT = process.env.PORT || 10000;
const server = app.listen(PORT, () => {
  console.log('✅ AI Voice Server running on port', PORT);
});

// WebSocket server on same port
const wss = new WebSocket.Server({ server });
wss.on('connection', function connection(ws) {
  console.log('🔊 WebSocket connected: receiving Twilio audio stream');
  let audioBuffer = [];

  ws.on('message', async function incoming(message) {
    const parsed = JSON.parse(message);
    const event = parsed.event;

    if (event === 'start') console.log('✅ Stream started from Twilio');
    if (event === 'media') {
      const buffer = Buffer.from(parsed.media.payload, 'base64');
      audioBuffer.push(buffer);
    }
    if (event === 'stop') {
      console.log('🛑 Stream ended');
      const finalAudio = Buffer.concat(audioBuffer);
      fs.writeFileSync('call.ulaw', finalAudio);
      execSync('sox -t ul -r 8000 -c 1 call.ulaw call.wav');
      const transcript = await transcribeWithWhisper('call.wav');
      console.log('📝 Whisper:', transcript);
      const reply = await chatWithGPT(transcript);
      console.log('🤖 GPT:', reply);
      await textToSpeech(reply);
    }
  });
});

async function transcribeWithWhisper(filePath) {
  const openai = axios.create({
    baseURL: 'https://api.openai.com/v1',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'multipart/form-data',
    },
  });
  const form = new (require('form-data'))();
  form.append('file', fs.createReadStream(filePath));
  form.append('model', 'whisper-1');
  const res = await openai.post('/audio/transcriptions', form, { headers: form.getHeaders() });
  return res.data.text;
}

async function chatWithGPT(text) {
  const res = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are a helpful AI voice assistant.' },
      { role: 'user', content: text }
    ]
  }, {
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  return res.data.choices[0].message.content;
}

async function textToSpeech(text) {
  const res = await axios.post('https://api.elevenlabs.io/v1/text-to-speech/pNInz6obpgDQGcFmaJgB/stream', {
    text,
    voice_settings: { stability: 0.3, similarity_boost: 0.75 }
  }, {
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json'
    },
    responseType: 'arraybuffer'
  });
  fs.writeFileSync('reply.mp3', Buffer.from(res.data));
}
