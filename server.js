const express = require('express');
const bodyParser = require('body-parser');
const { twiml } = require('twilio');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));

app.post('/voice', (req, res) => {
  const response = new twiml.VoiceResponse();
  response.start().stream({ url: 'wss://ai-phone-server-cwp0.onrender.com/audio' });
  response.say({ voice: 'Polly.Joanna', language: 'en-US' }, 'Hello, I am your AI assistant. How can I help you today?');
  res.type('text/xml');
  res.send(response.toString());
});

app.listen(10000, () => {
  console.log('✅ Minimal Twilio server running on port 10000');
});
