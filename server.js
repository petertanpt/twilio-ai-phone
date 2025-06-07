
const express = require('express');
const bodyParser = require('body-parser');
const { twiml } = require('twilio');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

// 兼容 GET 请求，防止 Twilio GET /voice 时直接挂断
app.get('/voice', (req, res) => {
  res.send('✅ AI 电话服务在线，请使用 POST 请求以接听电话。');
});

// 正常 POST 路由供 Twilio 使用
app.post('/voice', (req, res) => {
  const response = new twiml.VoiceResponse();

  response.start().stream({ url: 'wss://your-server.com/audio' });
  response.say({ voice: 'Polly.Joanna' }, '您好，我是AI语音助理，请问您需要什么服务？');

  res.type('text/xml');
  res.send(response.toString());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
