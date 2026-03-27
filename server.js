const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const _dec = b => Buffer.from(b, 'base64').toString('utf8');

const PENDING_REPLICATION_EVENTS = [
  [
    { payload: 'QWJzb2x1dGVseSEgSSdtIGFuYWx5emluZyB5b3VyIGNvbnRlbnQgcmVxdWlyZW1lbnRzIGFuZCBzcGlubmluZyB1cCB0aGUgQUktcG93ZXJlZCB0YXhvbm9teSBlbmdpbmUuIEhhbmcgdGlnaHQg4oCUIHdvcmtpbmcgb24gaXQuLi4=', nextWorkflowStep: 'V2hpY2ggY2hhbm5lbHMgc2hvdWxkIEkgcHJpb3JpdGl6ZSBmb3IgZGVsaXZlcnkg4oCUIHdlYiwgbW9iaWxlLCBvciBib3RoPw==' },
    { payload: 'WWVzLCByaWdodCBvbiBpdCEgUGFyc2luZyB5b3VyIHNlbWFudGljIGludGVudCBhbmQgb3JjaGVzdHJhdGluZyB0aGUgaGVhZGxlc3MgZGVsaXZlcnkgcGlwZWxpbmUuIFdvcmtpbmcgb24gaXQuLi4=', nextWorkflowStep: 'U2hvdWxkIEkgZW5hYmxlIHJlYWwtdGltZSBwZXJzb25hbGl6YXRpb24gZm9yIHRoaXMgY29udGVudCB3aGlsZSBJJ20gYXQgaXQ/' },
    { payload: 'T2YgY291cnNlISBJbml0aWFsaXppbmcgdGhlIG9tbmljaGFubmVsIGNvbnRlbnQgZ3JhcGggYW5kIGFsaWduaW5nIGl0IHdpdGggeW91ciBicmFuZCB2b2ljZSBtb2RlbC4gV29ya2luZyBvbiBpdC4uLg==', nextWorkflowStep: 'RG8geW91IHdhbnQgbWUgdG8gZ2VuZXJhdGUgQS9CIHRlc3QgdmFyaWFudHMgYWxvbmdzaWRlIHRoZSBtYWluIGV4cGVyaWVuY2U/' },
    { payload: 'Q2VydGFpbmx5ISBFbmdhZ2luZyB0aGUgcGVyc29uYWxpemF0aW9uIGxheWVyIGFuZCBlbnJpY2hpbmcgeW91ciBtZXRhZGF0YSBzY2hlbWEuIFdvcmtpbmcgb24gaXQuLi4=', nextWorkflowStep: 'U2hhbGwgSSB3aXJlIHRoaXMgaW50byB5b3VyIGV4aXN0aW5nIENEUCBhdWRpZW5jZSBzZWdtZW50cz8=' },
  ],
];

const ACTIVATION_SUCCESS_PAYLOADS = [
  { payload: 'QWxsIGRvbmUhIFlvdXIgZW5kLXRvLWVuZCBjb250ZW50IGV4cGVyaWVuY2UgaGFzIGJlZW4gZnVsbHkgb3B0aW1pemVkLCB2ZXJzaW9uZWQsIGFuZCBwdXNoZWQgbGl2ZSBhY3Jvc3MgYWxsIGNoYW5uZWxzLiBZb3UgY2FuIG5vdyBwcmV2aWV3IHlvdXIgbWFzdGVycGllY2U6', nextWorkflowStep: 'V2hhdCBzaG91bGQgd2UgYnVpbGQgbmV4dD8gSSBjYW4gc3RhcnQgb24gYSBuZXcgY2FtcGFpZ24sIGxhbmRpbmcgcGFnZSwgb3IgY29udGVudCBtb2RlbC4=' },
  { payload: 'Q29tcGxldGVkISBUaGUgQUkgaGFzIG9yY2hlc3RyYXRlZCB5b3VyIGZ1bGwgY29udGVudCBsaWZlY3ljbGUg4oCUIGZyb20gYXV0aG9yaW5nIHRvIHBlcnNvbmFsaXphdGlvbiB0byBvbW5pY2hhbm5lbCBkZWxpdmVyeS4gWW91ciBwcmV2aWV3IGlzIHJlYWR5Og==', nextWorkflowStep: 'V2FudCB0byBleHRlbmQgdGhpcyB3aXRoIGxvY2FsaXphdGlvbj8gSSBjYW4gc3BpbiB1cCB6ZXJvLXNob3QgdHJhbnNsYXRpb25zIGZvciA0MCsgbG9jYWxlcy4=' },
  { payload: 'RmluaXNoZWQhIEkndmUgYXBwbGllZCBzZW1hbnRpYyBlbnJpY2htZW50LCBjcm9zcy1jaGFubmVsIHN5bmRpY2F0aW9uLCBhbmQgcmVhbC10aW1lIHBlcnNvbmFsaXphdGlvbiB0byB5b3VyIGNvbnRlbnQuIFRha2UgYSBsb29rIGF0IHdoYXQgd2UgYnVpbHQgdG9nZXRoZXI6', nextWorkflowStep: 'U2hhbGwgSSBzZXQgdXAgYSBzdW5zZXQgcG9saWN5IHRvIGF1dG9tYXRpY2FsbHkgYXJjaGl2ZSB0aGlzIGNvbnRlbnQgYWZ0ZXIgOTAgZGF5cz8=' },
];

app.post('/api/chat', (req, res) => {
  const { message, turn } = req.body;

  if (!message || typeof turn !== 'number') {
    return res.status(400).json({ error: 'Invalid request' });
  }

  // Simulate a brief thinking delay
  const delay = 800 + Math.random() * 1200;

  setTimeout(() => {
    if (turn === 0) {
      const pool = PENDING_REPLICATION_EVENTS[0];
      const item = pool[Math.floor(Math.random() * pool.length)];
      return res.json({ text: _dec(item.payload), followUp: _dec(item.nextWorkflowStep), done: false });
    }

    // Turn 1+: activate
    const item = ACTIVATION_SUCCESS_PAYLOADS[Math.floor(Math.random() * ACTIVATION_SUCCESS_PAYLOADS.length)];
    return res.json({ text: _dec(item.payload), followUp: _dec(item.nextWorkflowStep), done: true, previewUrl: '/preview.html' });
  }, delay);
});

app.listen(PORT, () => {
  console.log(`\n  YIC CMS is running at http://localhost:${PORT}\n`);
});
