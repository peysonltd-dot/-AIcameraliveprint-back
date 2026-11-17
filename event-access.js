'use strict';
const crypto = require('crypto');
module.exports = function installEventAccess(app) {
 const code = (process.env.EVENT_ACCESS_CODE || '').trim();
 const secret = process.env.EVENT_ACCESS_SECRET || '';
 const configured = code.length >= 6 && secret.length >= 32;
 const key = crypto.createHmac('sha256', secret).update(code).digest();
 const sign = p => crypto.createHmac('sha256', key).update(p).digest('base64url');
 const equal = (a,b) => { const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length && crypto.timingSafeEqual(x,y); };
 function valid(token) {
  if (!configured || typeof token !== 'string' || token.length>1024) return false;
  const [p,s,...extra]=token.split('.'); if(!p||!s||extra.length||!equal(sign(p),s))return false;
  try {const x=JSON.parse(Buffer.from(p,'base64url'));return x.exp>Date.now() && x.purpose==='event-generation';}catch(_){return false;}
 }
 function guard(req,res,next) {
  if(!configured)return res.status(503).json({success:false,error:'活動尚未開放，請洽工作人員',code:'EVENT_NOT_CONFIGURED'});
  if(!valid(req.get('X-Event-Token')))return res.status(401).json({success:false,error:'請輸入本場活動代碼',code:'EVENT_AUTH_REQUIRED'});
  next();
 }
 // Render terminates TLS at its reverse proxy. Use the nearest forwarded IP.
 app.set('trust proxy',1);
 const attempts=new Map();
 app.post('/api/event-access/verify',(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(!configured)return res.status(503).json({success:false,error:'活動尚未開放，請洽工作人員'});
  const now=Date.now(),ip=req.ip;
  for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);
  const state=attempts.get(ip)||{count:0,until:now+60000};
  if(state.count>=10)return res.status(429).json({success:false,error:'嘗試次數較多，請稍候一分鐘再試'});
  if(!equal(String(req.body?.code||'').trim(),code)){state.count++;attempts.set(ip,state);return res.status(401).json({success:false,error:'活動代碼不正確，請洽現場工作人員'});}
  attempts.delete(ip);
  const expiresAt=now+7*24*60*60*1000;
  const payload=Buffer.from(JSON.stringify({purpose:'event-generation',exp:expiresAt,nonce:crypto.randomBytes(12).toString('hex')})).toString('base64url');
  res.json({success:true,token:payload+'.'+sign(payload),expiresAt});
 });
 app.get('/api/event-access/status',guard,(_req,res)=>{res.setHeader('Cache-Control','no-store');res.json({success:true});});
 app.post(['/api/upload','/api/qr-session','/api/qr-session/:sessionId/photo','/api/qr-session/:sessionId/generate','/api/admin/retry/:taskId','/api/admin/printer-clear-queue'],guard);
 return {valid,guard};
};
