'use strict';
const express = require('express');
const router  = express.Router();
const https   = require('https');
const { requireAuth } = require('./auth');
const { attachShopId } = require('./_shop-context');

// ── Config ────────────────────────────────────────────────────────────
const RESEND_KEY    = process.env.RESEND_API_KEY    || '';
const SENDGRID_KEY  = process.env.SENDGRID_API_KEY  || '';
const FROM_EMAIL    = process.env.FROM_EMAIL        || 'noreply@textilelab.studio';
const FROM_NAME     = process.env.FROM_NAME         || 'TextileLab Studio';
const STORE_URL     = process.env.SHOPIFY_STORE_URL || 'https://votre-boutique.myshopify.com';

// ── SMTP via Nodemailer ──────────────────────────────────────────────
// Variables Railway à configurer :
//   SMTP_HOST=smtp.ionos.fr  SMTP_PORT=587  SMTP_USER=xxx  SMTP_PASS=xxx
//   SMTP_FROM="TextileLab Studio <noreply@xxx.com>"  (optionnel, sinon FROM_EMAIL)
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || `${FROM_NAME} <${FROM_EMAIL}>`;
const SMTP_SECURE = process.env.SMTP_SECURE === 'true' || SMTP_PORT === 465;

let _nodemailerTransport = null;
function _getSmtpTransport() {
  if (_nodemailerTransport) return _nodemailerTransport;
  try {
    const nodemailer = require('nodemailer');
    _nodemailerTransport = nodemailer.createTransport({
      host:   SMTP_HOST,
      port:   SMTP_PORT,
      secure: SMTP_SECURE,
      auth:   { user: SMTP_USER, pass: SMTP_PASS },
    });
    console.log(`📧  SMTP transport initialisé → ${SMTP_HOST}:${SMTP_PORT}`);
    return _nodemailerTransport;
  } catch(e) {
    console.error('❌  Nodemailer non disponible :', e.message);
    return null;
  }
}

const PRODUCTS = { tshirt:'T-Shirt', hoodie:'Hoodie', cap:'Casquette', totebag:'Tote Bag' };
const STATUS_FR = { pending:'En attente', confirmed:'Confirmée', printing:'En impression', shipped:'Expédiée', done:'Terminée' };

// ── POST /api/email/order-confirmation (public, scopé shop) ──
router.post('/order-confirmation', attachShopId, async (req, res) => {
  const { order_id } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id required' });

  const { getDB } = require('../db/database');
  const db    = getDB();
  const order = db.prepare('SELECT * FROM orders WHERE id=? AND shop_id=?').get(order_id, req.shopId);
  if (!order)  return res.status(404).json({ error: 'Order not found' });
  if (!order.customer_email) return res.status(400).json({ error: 'No customer email' });

  const design = order.design_id
    ? db.prepare('SELECT * FROM designs WHERE id=? AND shop_id=?').get(order.design_id, req.shopId)
    : null;

  const html = buildOrderConfirmationHTML(order, design);
  const subject = `✅ Votre commande TextileLab #${order.id} est confirmée`;

  try {
    await sendEmail({ to: order.customer_email, subject, html });
    // Mark email sent
    db.prepare("UPDATE orders SET notes=COALESCE(notes||' | ','')|| 'email_sent:' || datetime('now') WHERE id=? AND shop_id=?").run(order_id, req.shopId);
    res.json({ ok: true, to: order.customer_email });
  } catch (err) {
    console.error('Email error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/email/shipping-update (admin, scopé shop) ───────────────────
router.post('/shipping-update', requireAuth, attachShopId, async (req, res) => {
  const { order_id, tracking_number, carrier } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id required' });

  const { getDB } = require('../db/database');
  const db    = getDB();
  const order = db.prepare('SELECT * FROM orders WHERE id=? AND shop_id=?').get(order_id, req.shopId);
  if (!order || !order.customer_email) return res.status(400).json({ error: 'Order not found or no email' });

  const html = buildShippingHTML(order, tracking_number, carrier);
  const subject = `📦 Votre commande TextileLab #${order.id} est expédiée !`;

  try {
    await sendEmail({ to: order.customer_email, subject, html });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/email/config (admin) — statut de la config email ─────────
router.get('/config', requireAuth, (req, res) => {
  let method = 'none';
  let details = 'Aucun service email configuré. Ajoutez SMTP_HOST ou RESEND_API_KEY dans Railway.';
  if (RESEND_KEY)   { method = 'resend';   details = 'Resend API'; }
  if (SENDGRID_KEY) { method = 'sendgrid'; details = 'SendGrid API'; }
  if (SMTP_HOST)    { method = 'smtp';     details = `SMTP ${SMTP_USER}@${SMTP_HOST}:${SMTP_PORT}`; }
  res.json({ method, details, from: SMTP_FROM || FROM_EMAIL });
});

// ── POST /api/email/test (admin) ──────────────────────────────────────
router.post('/test', requireAuth, async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'to required' });

  // Vérifier qu'un service est bien configuré
  if (!RESEND_KEY && !SENDGRID_KEY && !SMTP_HOST) {
    return res.status(400).json({
      error: 'Aucun service email configuré. Ajoutez SMTP_HOST+SMTP_USER+SMTP_PASS (ou RESEND_API_KEY) dans les variables Railway.',
      config_help: {
        smtp_ionos:   'SMTP_HOST=smtp.ionos.fr  SMTP_PORT=587  SMTP_USER=votre@email.com  SMTP_PASS=motdepasse',
        smtp_gmail:   'SMTP_HOST=smtp.gmail.com SMTP_PORT=587  SMTP_USER=votre@gmail.com  SMTP_PASS=mot-de-passe-app',
        resend:       'RESEND_API_KEY=re_xxxx (gratuit jusqu\'à 3000 emails/mois)',
      },
    });
  }

  try {
    await sendEmail({
      to,
      subject: '🧪 Test email — TextileLab Studio',
      html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:40px">
        <h1 style="color:#F59E0B">TextileLab Studio</h1>
        <p>Si vous recevez cet email, la configuration est correcte ✅</p>
        <p style="color:#555;font-size:13px;margin-top:16px">Service utilisé : <strong>${SMTP_HOST ? 'SMTP (' + SMTP_HOST + ')' : RESEND_KEY ? 'Resend' : 'SendGrid'}</strong></p>
        <p style="color:#999;font-size:12px;margin-top:24px">Envoyé depuis ${SMTP_FROM || FROM_EMAIL}</p>
      </div>`,
    });
    res.json({ ok: true, to, method: SMTP_HOST ? 'smtp' : RESEND_KEY ? 'resend' : 'sendgrid' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════
// EMAIL SENDER — Resend en priorité, SendGrid en fallback, log en dev
// ════════════════════════════════════════════════════════════════════════
async function sendEmail({ to, subject, html }) {
  if (RESEND_KEY)   return sendViaResend({ to, subject, html });
  if (SENDGRID_KEY) return sendViaSendGrid({ to, subject, html });
  if (SMTP_HOST)    return sendViaSMTP({ to, subject, html });

  // Dev mode — juste logger
  console.log(`\n📧  [EMAIL DEV MODE — aucun service configuré]`);
  console.log(`   To      : ${to}`);
  console.log(`   Subject : ${subject}`);
  console.log(`   Configurez SMTP_HOST+SMTP_USER+SMTP_PASS ou RESEND_API_KEY dans Railway\n`);
  return { ok: true, dev: true };
}

function sendViaSMTP({ to, subject, html }) {
  return new Promise((resolve, reject) => {
    const transport = _getSmtpTransport();
    if (!transport) return reject(new Error('Transport SMTP non disponible'));
    transport.sendMail({ from: SMTP_FROM, to, subject, html }, (err, info) => {
      if (err) {
        console.error(`❌  SMTP sendMail → ${to} :`, err.message);
        return reject(err);
      }
      console.log(`📧  Email envoyé via SMTP → ${to} (id: ${info.messageId})`);
      resolve({ ok: true, messageId: info.messageId });
    });
  });
}

function sendViaResend({ to, subject, html }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [to],
      subject,
      html,
    });
    const req = https.request({
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`📧  Email sent via Resend → ${to}`);
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`Resend error ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sendViaSendGrid({ to, subject, html }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: FROM_EMAIL, name: FROM_NAME },
      subject,
      content: [{ type: 'text/html', value: html }],
    });
    const req = https.request({
      hostname: 'api.sendgrid.com',
      path: '/v3/mail/send',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SENDGRID_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      if (res.statusCode === 202) {
        console.log(`📧  Email sent via SendGrid → ${to}`);
        resolve({ ok: true });
      } else {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => reject(new Error(`SendGrid error ${res.statusCode}: ${data}`)));
      }
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ════════════════════════════════════════════════════════════════════════
// EMAIL TEMPLATES
// ════════════════════════════════════════════════════════════════════════
function emailBase(content) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TextileLab Studio</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

  <!-- HEADER -->
  <tr><td style="background:#0a0a0a;border-radius:16px 16px 0 0;padding:32px 36px 24px;text-align:center;border-bottom:1px solid #222">
    <div style="font-family:'Arial Black',Arial,sans-serif;font-size:26px;font-weight:900;letter-spacing:-0.5px;color:#ffffff">
      Textile<span style="color:#F59E0B">Lab</span>
    </div>
    <div style="color:#444;font-size:10px;font-family:'Courier New',monospace;margin-top:4px;letter-spacing:3px;text-transform:uppercase">
      Studio
    </div>
    <div style="color:#555;font-size:10px;font-family:'Courier New',monospace;margin-top:10px;letter-spacing:2px">
      TON STYLE, TES CRÉATIONS, TON UNIVERS
    </div>
  </td></tr>

  <!-- BODY -->
  <tr><td style="background:#111111;padding:36px;border-left:1px solid #222;border-right:1px solid #222">
    ${content}
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#0a0a0a;border:1px solid #222;border-top:none;border-radius:0 0 16px 16px;padding:20px 36px;text-align:center">
    <p style="color:#444;font-size:11px;margin:0">
      TextileLab Studio · Personnalisation textile premium<br>
      <a href="${STORE_URL}" style="color:#F59E0B;text-decoration:none">${STORE_URL}</a>
    </p>
    <p style="color:#333;font-size:10px;margin:8px 0 0">
      Vous recevez cet email car vous avez passé une commande sur notre boutique.
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

function buildOrderConfirmationHTML(order, design) {
  const productName = PRODUCTS[order.product] || order.product;
  const totalFmt    = parseFloat(order.total_price || 0).toFixed(2).replace('.', ',');
  const dateStr     = new Date(order.created_at).toLocaleDateString('fr-FR', { year:'numeric', month:'long', day:'numeric' });
  const orderNum    = String(order.id).padStart(4, '0');

  const APP_URL = (process.env.APP_URL || process.env.SHOPIFY_APP_URL || '').replace(/\/$/, '');
  const shopUrl = (process.env.SHOPIFY_APP_URL || STORE_URL || '').replace(/\/$/, '');

  // ── Thumbnails recto/verso depuis views_preview_json ──
  let thumbnailBlock = '';
  if (design?.views_preview_json) {
    try {
      const vp      = JSON.parse(design.views_preview_json);
      const entries = Object.values(vp).filter(v => v?.url);
      if (entries.length) {
        thumbnailBlock = `
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0">
            <tr><td style="text-align:center;padding-bottom:10px">
              <span style="font-size:10px;color:#555;font-family:'Courier New',monospace;letter-spacing:2px;text-transform:uppercase">Aperçu de ton design</span>
            </td></tr>
            <tr><td style="text-align:center">
              ${entries.map(v => `
                <img src="${v.url}" alt="${v.name || 'design'}" width="160" height="160"
                     style="display:inline-block;margin:0 8px;border-radius:12px;border:2px solid #2a2a2a;object-fit:contain;background:#1a1a1a">
              `).join('')}
            </td></tr>
          </table>`;
      }
    } catch(e) {}
  }
  if (!thumbnailBlock && design?.thumbnail) {
    thumbnailBlock = `
      <table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0">
        <tr><td style="text-align:center">
          <img src="${design.thumbnail}" alt="Votre design" width="180" height="180"
               style="display:inline-block;border-radius:12px;border:2px solid #2a2a2a;object-fit:contain;background:#1a1a1a">
        </td></tr>
      </table>`;
  }

  const content = `
    <!-- Hero -->
    <div style="text-align:center;margin-bottom:32px">
      <h1 style="font-size:26px;font-weight:900;color:#ffffff;margin:0 0 8px;letter-spacing:-0.5px">
        MERCI POUR<br>TA COMMANDE !
      </h1>
      <p style="color:#666;font-size:13px;margin:0;line-height:1.6">
        Ta création est bien enregistrée.<br>On s'occupe du reste et on te prévient dès l'expédition.
      </p>
    </div>

    <!-- Order number -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px">
      <tr><td style="background:#161616;border:1px solid #2a2a2a;border-radius:14px;padding:20px;text-align:center">
        <div style="font-size:11px;color:#555;font-family:'Courier New',monospace;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px">
          Numéro de commande
        </div>
        <div style="font-size:32px;font-weight:900;color:#F59E0B;font-family:'Courier New',monospace;letter-spacing:-1px">
          #${orderNum}
        </div>
        <div style="font-size:11px;color:#444;margin-top:4px">${dateStr}</div>
      </td></tr>
    </table>

    <!-- CTA voir commande -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
      <tr><td style="text-align:center">
        <a href="${shopUrl}/account/orders"
           style="display:inline-block;background:#F59E0B;color:#000000;font-weight:700;font-size:14px;
                  padding:14px 36px;border-radius:10px;text-decoration:none;letter-spacing:0.5px">
          VOIR MA COMMANDE →
        </a>
      </td></tr>
    </table>

    ${thumbnailBlock}

    <!-- Résumé commande -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;border-top:1px solid #222">
      <tr><td colspan="2" style="padding:16px 0 10px">
        <span style="font-size:10px;color:#555;font-family:'Courier New',monospace;letter-spacing:2px;text-transform:uppercase">
          Résumé de la commande
        </span>
      </td></tr>
      <tr style="border-bottom:1px solid #1e1e1e">
        <td style="padding:10px 0;color:#888;font-size:13px">Produit</td>
        <td style="padding:10px 0;font-weight:600;font-size:13px;text-align:right;color:#ccc">${productName}</td>
      </tr>
      <tr style="border-bottom:1px solid #1e1e1e">
        <td style="padding:10px 0;color:#888;font-size:13px">Format</td>
        <td style="padding:10px 0;font-weight:600;font-size:13px;text-align:right;color:#ccc">${order.format || '—'}</td>
      </tr>
      <tr style="border-bottom:1px solid #1e1e1e">
        <td style="padding:10px 0;color:#888;font-size:13px">Couleur textile</td>
        <td style="padding:10px 0;text-align:right">
          <span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:#ccc">
            <span style="display:inline-block;width:14px;height:14px;background:${order.color||'#ffffff'};border:1px solid #444;border-radius:3px"></span>
            ${order.color || '—'}
          </span>
        </td>
      </tr>
      <tr style="border-bottom:1px solid #1e1e1e">
        <td style="padding:10px 0;color:#888;font-size:13px">Quantité</td>
        <td style="padding:10px 0;font-weight:600;font-size:13px;text-align:right;color:#ccc">${order.quantity || 1}</td>
      </tr>
      <tr>
        <td style="padding:14px 0;font-weight:700;font-size:15px;color:#fff">Total</td>
        <td style="padding:14px 0;font-weight:900;font-size:22px;color:#F59E0B;text-align:right;font-family:'Courier New',monospace">
          ${totalFmt} €
        </td>
      </tr>
    </table>

    <!-- Timeline -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
      <tr><td style="background:#161616;border:1px solid #222;border-radius:12px;padding:20px">
        <div style="font-size:10px;color:#555;font-family:'Courier New',monospace;letter-spacing:2px;text-transform:uppercase;margin-bottom:16px">
          Suivi de commande
        </div>
        ${['Commande confirmée ✅','En préparation impression','Expédition','Livraison'].map((step, i) => `
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:${i<3?'10px':'0'}">
            <tr>
              <td width="28" valign="middle">
                <div style="width:24px;height:24px;border-radius:50%;background:${i===0?'#F59E0B':'#1e1e1e'};text-align:center;line-height:24px;font-size:11px;font-weight:700;color:${i===0?'#000':'#444'};border:1px solid ${i===0?'#F59E0B':'#2a2a2a'}">${i+1}</div>
              </td>
              <td style="padding-left:10px;font-size:13px;color:${i===0?'#ffffff':'#444'};font-weight:${i===0?600:400}">${step}</td>
              ${i===0?`<td style="text-align:right;font-size:11px;color:#555;font-family:'Courier New',monospace">${dateStr}</td>`:'<td></td>'}
            </tr>
          </table>`).join('')}
      </td></tr>
    </table>

    <p style="color:#555;font-size:12px;line-height:1.6;margin:0;text-align:center">
      Des questions ? Réponds à cet email, on est là pour toi.
    </p>
  `;

  return emailBase(content);
}

function buildShippingHTML(order, trackingNumber, carrier) {
  const productName = PRODUCTS[order.product] || order.product;

  const content = `
    <div style="text-align:center;margin-bottom:28px">
      <div style="font-size:40px;margin-bottom:12px">📦</div>
      <h1 style="font-size:22px;font-weight:700;color:#111;margin:0 0 8px">Votre commande est expédiée !</h1>
      <p style="color:#666;font-size:14px;margin:0">Votre ${productName} personnalisé est en route.</p>
    </div>

    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px;margin-bottom:24px;text-align:center">
      <div style="font-size:11px;color:#166534;font-family:'Courier New',monospace;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Numéro de suivi</div>
      <div style="font-size:20px;font-weight:700;color:#16a34a;font-family:'Courier New',monospace">${trackingNumber || 'À venir'}</div>
      ${carrier?`<div style="font-size:12px;color:#4ade80;margin-top:4px">${carrier}</div>`:''}
    </div>

    <p style="color:#666;font-size:13px;line-height:1.6;text-align:center">
      Commande <strong>#${String(order.id).padStart(5,'0')}</strong> · ${productName} ${order.format}<br>
      Livraison estimée sous 2 à 5 jours ouvrés.
    </p>
  `;

  return emailBase(content);
}

module.exports = router;
module.exports.sendEmail = sendEmail;
module.exports.buildOrderConfirmationHTML = buildOrderConfirmationHTML;
