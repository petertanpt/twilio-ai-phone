
const express = require('express');
const { twiml } = require('twilio');

const app = express();

app.post('/voice', (req, res) => {
  const response = new twiml.VoiceResponse();
  response.say({ voice: 'Polly.Joanna', language: 'zh-CN' }, '您好，这里是 AI 电话助手演示，请问我能为您做些什么？');
  res.type('text/xml');
  res.send(response.toString());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Minimal Twilio server running on port ${PORT}`);
});
