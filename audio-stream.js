const WebSocket = require('ws');
const fs = require('fs');
const axios = require('axios');
const { execSync } = require('child_process');
require('dotenv').config();

const wss = new WebSocket.Server({ port: 8080 });

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

      const audioUrl = await textToSpeech(reply);
      console.log('🔊 TTS saved to file:', audioUrl);
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

  const res = await openai.post('/audio/transcriptions', form, {
    headers: form.getHeaders()
  });

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

  const audioFile = 'reply.mp3';
  fs.writeFileSync(audioFile, Buffer.from(res.data));
  return audioFile;
}

console.log('🎧 Audio WebSocket server on port 8080');
