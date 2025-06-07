
const express = require('express');
const fs = require('fs');
const fetch = require('node-fetch');
const multer = require('multer');
const bodyParser = require('body-parser');
const { twiml } = require('twilio');

const app = express();
const upload = multer();
app.use(bodyParser.urlencoded({ extended: false }));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;

let lastReplyReady = false;

app.post('/voice', async (req, res) => {
  const response = new twiml.VoiceResponse();

  if (lastReplyReady && fs.existsSync('reply.mp3')) {
    response.play({}, 'https://' + req.headers.host + '/reply.mp3');
    lastReplyReady = false;
  } else {
    response.say('Hello, I am your AI assistant. Please speak after the beep.');
    response.record({
      maxLength: 10,
      action: '/process-recording',
      method: 'POST',
      trim: 'do-not-trim'
    });
  }

  res.type('text/xml');
  res.send(response.toString());
});

app.post('/process-recording', async (req, res) => {
  const recordingUrl = req.body.RecordingUrl + '.wav';

  const audioRes = await fetch(recordingUrl);
  const audioBuffer = await audioRes.buffer();
  fs.writeFileSync('recording.wav', audioBuffer);

  const transcript = await transcribeWithWhisper('recording.wav');
  const gptReply = await chatWithGPT(transcript);
  await synthesizeWithElevenLabs(gptReply);

  lastReplyReady = true;

  const response = new twiml.VoiceResponse();
  response.redirect('/voice');
  res.type('text/xml');
  res.send(response.toString());
});

app.get('/reply.mp3', (req, res) => {
  const file = 'reply.mp3';
  if (fs.existsSync(file)) {
    res.set('Content-Type', 'audio/mpeg');
    res.sendFile(__dirname + '/reply.mp3');
  } else {
    res.status(404).send('Not ready');
  }
});

async function transcribeWithWhisper(filepath) {
  const formData = new fetch.FormData();
  formData.append('file', fs.createReadStream(filepath));
  formData.append('model', 'whisper-1');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: formData
  });

  const data = await response.json();
  return data.text;
}

async function chatWithGPT(text) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: '你是一个电话客服，请用简洁自然的语言回答客户。' },
        { role: 'user', content: text }
      ]
    })
  });

  const data = await res.json();
  return data.choices[0].message.content;
}

async function synthesizeWithElevenLabs(text) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      text: text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.5 }
    })
  });

  const buffer = await res.buffer();
  fs.writeFileSync('reply.mp3', buffer);
}

app.listen(process.env.PORT || 3000, () => {
  console.log('✅ AI Voice Server running');
});
