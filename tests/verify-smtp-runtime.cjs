const assert = require('node:assert/strict');
const net = require('node:net');
const { createRequire } = require('node:module');
const path = require('node:path');
const nodemailer = createRequire(path.resolve(__dirname, '../server/package.json'))('nodemailer');
let message = '';
const server = net.createServer(socket => {
  socket.setEncoding('utf8'); socket.write('220 operis-test ESMTP\r\n');
  let dataMode = false;
  socket.on('data', chunk => {
    if (dataMode) { message += chunk; if (message.includes('\r\n.\r\n')) { dataMode=false; socket.write('250 queued\r\n'); } return; }
    for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
      if (/^(EHLO|HELO)/i.test(line)) socket.write('250-operis-test\r\n250 AUTH PLAIN\r\n');
      else if (/^AUTH PLAIN/i.test(line)) socket.write('235 authenticated\r\n');
      else if (/^(MAIL FROM|RCPT TO)/i.test(line)) socket.write('250 ok\r\n');
      else if (/^DATA/i.test(line)) { dataMode=true; socket.write('354 end with dot\r\n'); }
      else if (/^QUIT/i.test(line)) { socket.write('221 bye\r\n'); socket.end(); }
    }
  });
});
server.listen(0, '127.0.0.1', async () => {
  try {
    const port = server.address().port;
    const transport = nodemailer.createTransport({ host:'127.0.0.1', port, secure:false, auth:{user:'operis',pass:'test-password'}, connectionTimeout:5000, greetingTimeout:5000, socketTimeout:5000, tls:{rejectUnauthorized:false} });
    const info = await transport.sendMail({ from:'operis@example.com', to:'recipient@example.com', subject:'OPERIS SMTP regression', text:'verified body' });
    assert.ok(info.accepted.includes('recipient@example.com'));
    assert.match(message, /Subject: OPERIS SMTP regression/);
    assert.match(message, /verified body/);
    transport.close(); console.log('SMTP_NODEMAILER_RUNTIME_PASS');
  } finally { server.close(); }
}).on('error', error => { console.error(error); process.exitCode=1; });
