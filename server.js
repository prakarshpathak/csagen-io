/* Plain Node HTTP server for Hostinger / any VPS (no framework, no dependencies).
 * Serves POST /api/sign using the same core as the Vercel function.
 *   Run: PORT=3000 DS_INTEGRATION_KEY=... node server.js
 */
import http from 'node:http';
import { handleSignRequest, corsHeaders } from './lib/docusign.js';

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  const headers = corsHeaders(process.env);
  const path = (req.url || '').split('?')[0].replace(/\/$/, '');

  if(req.method === 'OPTIONS'){ res.writeHead(204, headers); return res.end(); }
  if(path !== '/api/sign' && path !== '/sign'){
    res.writeHead(404, { ...headers, 'Content-Type':'application/json' });
    return res.end(JSON.stringify({ ok:false, error:'Not found' }));
  }
  if(req.method !== 'POST'){
    res.writeHead(405, { ...headers, 'Content-Type':'application/json' });
    return res.end(JSON.stringify({ ok:false, error:'POST only' }));
  }

  let data = '';
  req.on('data', c => { data += c; });
  req.on('end', async () => {
    let body = {};
    try { body = JSON.parse(data || '{}'); } catch {}
    const { status, json } = await handleSignRequest(body, process.env);
    res.writeHead(status, { ...headers, 'Content-Type':'application/json' });
    res.end(JSON.stringify(json));
  });
}).listen(PORT, () => console.log('CSA sign server listening on :' + PORT));
