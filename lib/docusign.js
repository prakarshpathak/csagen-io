/* CSA Generator - DocuSign signing core (framework-agnostic, zero dependencies).
 *
 * Exposes handleSignRequest(body, env) -> { status, json } and corsHeaders(env).
 * Used by both the Vercel function (api/sign.js) and the Node server (server.js).
 *
 * If DocuSign env vars are not set it runs in DRY-RUN mode: it validates the
 * request and returns what it WOULD send, without calling DocuSign - so the full
 * browser -> function loop can be tested before any credentials exist.
 */
import crypto from 'node:crypto';

function b64url(input){
  return Buffer.from(input).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

/* Sign an RS256 JWT with node:crypto (no external JWT library). */
function signJwtRS256(payload, privateKey){
  const header = { alg:'RS256', typ:'JWT' };
  const data = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(payload));
  const sig = crypto.createSign('RSA-SHA256').update(data).sign(privateKey);
  return data + '.' + b64url(sig);
}

function cfg(env){
  env = env || {};
  return {
    integrationKey: env.DS_INTEGRATION_KEY,
    userId:         env.DS_USER_ID,
    accountId:      env.DS_ACCOUNT_ID,
    privateKey:     (env.DS_PRIVATE_KEY || '').replace(/\\n/g, '\n'),  // env vars escape newlines
    oauthBase:      env.DS_OAUTH_BASE || 'account-d.docusign.com',     // demo default; prod: account.docusign.com
    restBase:      (env.DS_REST_BASE  || 'https://demo.docusign.net').replace(/\/$/,''), // prod: https://www.docusign.net
    allowedOrigin:  env.ALLOWED_ORIGIN || '*'
  };
}
function isConfigured(c){ return !!(c.integrationKey && c.userId && c.accountId && c.privateKey); }

export function corsHeaders(env){
  return {
    'Access-Control-Allow-Origin':  cfg(env).allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

async function getAccessToken(c){
  const now = Math.floor(Date.now()/1000);
  const jwt = signJwtRS256({
    iss: c.integrationKey, sub: c.userId, aud: c.oauthBase,
    iat: now, exp: now + 3600, scope: 'signature impersonation'
  }, c.privateKey);
  const res = await fetch(`https://${c.oauthBase}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
  });
  const j = await res.json().catch(()=>({}));
  if(!res.ok){
    // consent_required means an admin must grant consent once for this integration key
    throw new Error('DocuSign auth failed: ' + (j.error || res.status) + (j.error_description ? ' - '+j.error_description : ''));
  }
  return j.access_token;
}

function buildEnvelope({ documentHtml, documentName, signerName, signerEmail, emailSubject }){
  return {
    emailSubject: emailSubject || ('Please sign: ' + documentName),
    documents: [{
      documentBase64: Buffer.from(documentHtml, 'utf8').toString('base64'),
      name: documentName,
      fileExtension: 'html',   // DocuSign converts HTML to a signable PDF
      documentId: '1'
    }],
    recipients: { signers: [{
      email: signerEmail, name: signerName, recipientId: '1', routingOrder: '1',
      tabs: {
        // anchor tabs auto-place on the "Signature" / "Date" labels already in the doc
        signHereTabs:   [{ anchorString: 'Signature', anchorUnits: 'pixels', anchorXOffset: '110', anchorYOffset: '-4' }],
        dateSignedTabs: [{ anchorString: 'Date',      anchorUnits: 'pixels', anchorXOffset: '110', anchorYOffset: '-4' }]
      }
    }]},
    status: 'sent'
  };
}

async function createEnvelope(c, token, envelope){
  const res = await fetch(`${c.restBase}/restapi/v2.1/accounts/${c.accountId}/envelopes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope)
  });
  const j = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error('DocuSign envelope failed: ' + (j.message || j.errorCode || res.status));
  return j; // { envelopeId, status, ... }
}

export async function handleSignRequest(body, env){
  const c = cfg(env);
  body = body || {};
  const signer = body.signer || {};
  const doc = body.document || {};

  const errors = [];
  if(!signer.email) errors.push('signer.email is required');
  if(!signer.name)  errors.push('signer.name is required');
  if(!doc.html)     errors.push('document.html is required');
  if(errors.length) return { status: 400, json: { ok:false, errors } };

  const envelope = buildEnvelope({
    documentHtml: doc.html,
    documentName: doc.filename || 'CSA.html',
    signerName:   signer.name,
    signerEmail:  signer.email,
    emailSubject: body.emailSubject
  });

  if(!isConfigured(c)){
    return { status: 200, json: {
      ok: true, dryRun: true,
      message: 'DRY RUN: DocuSign env not configured. Envelope built but not sent.',
      preview: {
        emailSubject: envelope.emailSubject,
        signer: { name: signer.name, email: signer.email },
        documentBytes: doc.html.length,
        deal: body.deal || null
      }
    }};
  }

  try{
    const token = await getAccessToken(c);
    const result = await createEnvelope(c, token, envelope);
    return { status: 200, json: { ok:true, dryRun:false, envelopeId: result.envelopeId, status: result.status } };
  }catch(e){
    return { status: 502, json: { ok:false, error: String(e && e.message || e) } };
  }
}
