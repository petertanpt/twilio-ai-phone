const express = require('express');
const bodyParser = require('body-parser');
const { twiml } = require('twilio');
const WebSocket = require('ws');
const fs = require('fs');
const axios = require('axios');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

app.post('/voice', (req, res) => {
  const response = new twiml.VoiceResponse();
  response.start().stream({ url: 'wss://your-server.com/audio' });
  response.say({ voice: 'Polly.Joanna' }, '您好，我是AI语音助理，请问您需要什么服务？');
  res.type('text/xml');
  res.send(response.toString());
});

app.listen(3000, () => {
  console.log('🚀 HTTP server running on port 3000');
});

const wss = new WebSocket.Server({ port: 8080 });

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
      const transcript = await transcribeWithWhisper('call.ulaw');
      console.log('📝 AI识别结果：', transcript);
      const reply = await chatWithGPT(transcript);
      console.log('🤖 GPT 回复：', reply);
    }
  });
});

async function transcribeWithWhisper(filePath) {
  return '你好，我想预约明天下午三点';
}

async function chatWithGPT(transcriptText) {
  const res = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: '你是一个电话语音助手，请简洁清晰回答客户问题。' },
      { role: 'user', content: transcriptText }
    ]
  }, {
    headers: {
      Authorization: `Bearer YOUR_OPENAI_API_KEY`,
      'Content-Type': 'application/json'
    }
  });
  return res.data.choices[0].message.content;
}