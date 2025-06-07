
const express = require('express');
const bodyParser = require('body-parser');
const { twiml } = require('twilio');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

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
