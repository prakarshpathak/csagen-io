/* Vercel serverless function: POST /api/sign
 * Thin wrapper around the framework-agnostic core in lib/docusign.js. */
import { handleSignRequest, corsHeaders } from '../lib/docusign.js';

function readBody(req){
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

export default async function handler(req, res){
  const headers = corsHeaders(process.env);
  for(const [k, v] of Object.entries(headers)) res.setHeader(k, v);

  if(req.method === 'OPTIONS') return res.status(204).end();
  if(req.method !== 'POST') return res.status(405).json({ ok:false, error:'POST only' });

  let body = req.body;
  if(body == null) body = await readBody(req);                 // some runtimes don't pre-parse
  else if(typeof body === 'string'){ try { body = JSON.parse(body); } catch { body = {}; } }

  const { status, json } = await handleSignRequest(body, process.env);
  res.status(status).json(json);
}
