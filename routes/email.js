'use strict';
const express = require('express');
const router  = express.Router();
const https   = require('https');
const { requireAuth } = require('./auth');

// ── Config ────────────────────────────────────────────────────────────
const RESEND_KEY    = process.env.RESEND_API_KEY    || '';
const SENDGRID_KEY  = process.env.SENDGRID_API_KEY  || '';
const FROM_EMAIL    = process.env.FROM_EMAIL        || 'noreply@textilelab.studio';
const FROM_NAME     = process.env.FROM_NAME         || 'TextileLab Studio';
const STORE_URL     = process.env.SHOPIFY_STORE_URL || 'https://votre-boutique.myshopify.com';

const PRODUCTS = { tshirt:'T-Shirt', hoodie:'Hoodie', cap:'Casquette', totebag:'Tote Bag' };
const STATUS_FR = { pending:'En attente', confirmed:'Confirmée', printing:'En impression', shipped:'Expédiée', done:'Terminée' };

// ── POST /api/email/order-confirmation (public — called by studio after order creation) ──
router.post('/order-confirmation', async (req, res) => {
  const { order_id } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id required' });

  const { getDB } = require('../db/database');
  const db    = getDB();
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(order_id);
  if (!order)  return res.status(404).json({ error: 'Order not found' });
  if (!order.customer_email) return res.status(400).json({ error: 'No customer email' });

  const design = order.design_id
    ? db.prepare('SELECT * FROM designs WHERE id=?').get(order.design_id)
    : null;

  const html = buildOrderConfirmationHTML(order, design);
  const subject = `✅ Votre commande TextileLab #${order.id} est confirmée`;

  try {
    await sendEmail({ to: order.customer_email, subject, html });
    // Mark email sent
    db.prepare("UPDATE orders SET notes=COALESCE(notes||' | ','')|| 'email_sent:' || datetime('now') WHERE id=?").run(order_id);
    res.json({ ok: true, to: order.customer_email });
  } catch (err) {
    console.error('Email error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/email/shipping-update (admin) ───────────────────────────
router.post('/shipping-update', requireAuth, async (req, res) => {
  const { order_id, tracking_number, carrier } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id required' });

  const { getDB } = require('../db/database');
  const db    = getDB();
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(order_id);
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

// ── POST /api/email/test (admin) ──────────────────────────────────────
router.post('/test', requireAuth, async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'to required' });
  try {
    await sendEmail({
      to,
      subject: '🧪 Test email — TextileLab Studio',
      html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:40px">
        <h1 style="color:#F59E0B">TextileLab Studio</h1>
        <p>Si vous recevez cet email, la configuration est correcte ✅</p>
        <p style="color:#999;font-size:12px;margin-top:24px">Envoyé depuis ${FROM_EMAIL}</p>
      </div>`,
    });
    res.json({ ok: true, to });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════
// EMAIL SENDER — Resend en priorité, SendGrid en fallback, log en dev
// ════════════════════════════════════════════════════════════════════════
async function sendEmail({ to, subject, html }) {
  if (RESEND_KEY) {
    return sendViaResend({ to, subject, html });
  }
  if (SENDGRID_KEY) {
    return sendViaSendGrid({ to, subject, html });
  }
  // Dev mode — juste logger
  console.log(`\n📧  [EMAIL DEV MODE]`);
  console.log(`   To      : ${to}`);
  console.log(`   Subject : ${subject}`);
  console.log(`   (Ajoutez RESEND_API_KEY ou SENDGRID_API_KEY dans .env pour l'envoi réel)\n`);
  return { ok: true, dev: true };
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
<body style="margin:0;padding:0;background:#f4f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f8;padding:40px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

  <!-- HEADER -->
  <tr><td style="background:#0a0a0c;border-radius:16px 16px 0 0;padding:28px 36px;text-align:center">
    <div style="font-family:'Arial Black',sans-serif;font-size:22px;font-weight:900;color:#fff">
      Textile<span style="color:#F59E0B">Lab</span>
    </div>
    <div style="color:#555;font-size:11px;font-family:'Courier New',monospace;margin-top:4px;letter-spacing:2px">
      STUDIO
    </div>
  </td></tr>

  <!-- BODY -->
  <tr><td style="background:#ffffff;padding:36px;border-left:1px solid #e8e8f0;border-right:1px solid #e8e8f0">
    ${content}
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#f8f8fc;border:1px solid #e8e8f0;border-top:none;border-radius:0 0 16px 16px;padding:20px 36px;text-align:center">
    <p style="color:#aaa;font-size:11px;margin:0">
      TextileLab Studio · Personnalisation textile premium<br>
      <a href="${STORE_URL}" style="color:#F59E0B;text-decoration:none">${STORE_URL}</a>
    </p>
    <p style="color:#ccc;font-size:10px;margin:8px 0 0">
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
  const totalFmt    = parseFloat(order.total_price).toFixed(2).replace('.', ',');
  const unitFmt     = parseFloat(order.unit_price).toFixed(2).replace('.', ',');
  const extraFmt    = parseFloat(order.format_price).toFixed(2).replace('.', ',');
  const dateStr     = new Date(order.created_at).toLocaleDateString('fr-FR', { year:'numeric', month:'long', day:'numeric' });

  const thumbnailBlock = design?.thumbnail
    ? `<div style="text-align:center;margin:24px 0">
        <img src="${design.thumbnail}" alt="Votre design" style="max-width:200px;max-height:200px;border-radius:12px;border:2px solid #f0f0f8;object-fit:contain">
        <div style="font-size:11px;color:#aaa;margin-top:6px">${design.name || 'Votre design'}</div>
       </div>`
    : '';

  const content = `
    <!-- Hero -->
    <div style="text-align:center;margin-bottom:28px">
      <div style="font-size:40px;margin-bottom:12px">✅</div>
      <h1 style="font-size:22px;font-weight:700;color:#111;margin:0 0 8px">Commande confirmée !</h1>
      <p style="color:#666;font-size:14px;margin:0">Merci pour votre commande. Nous allons la préparer avec soin.</p>
    </div>

    <!-- Order number -->
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:14px 20px;margin-bottom:24px;text-align:center">
      <span style="font-size:11px;color:#92400e;font-family:'Courier New',monospace;text-transform:uppercase;letter-spacing:1px">Numéro de commande</span>
      <div style="font-size:24px;font-weight:700;color:#F59E0B;font-family:'Courier New',monospace">#${String(order.id).padStart(5,'0')}</div>
    </div>

    ${thumbnailBlock}

    <!-- Order details -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
      <tr style="border-bottom:1px solid #f0f0f8">
        <td style="padding:10px 0;color:#888;font-size:13px">Produit</td>
        <td style="padding:10px 0;font-weight:600;font-size:13px;text-align:right">${productName}</td>
      </tr>
      <tr style="border-bottom:1px solid #f0f0f8">
        <td style="padding:10px 0;color:#888;font-size:13px">Format d'impression</td>
        <td style="padding:10px 0;font-weight:600;font-size:13px;text-align:right">${order.format}</td>
      </tr>
      <tr style="border-bottom:1px solid #f0f0f8">
        <td style="padding:10px 0;color:#888;font-size:13px">Couleur du textile</td>
        <td style="padding:10px 0;text-align:right">
          <span style="display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600">
            <span style="display:inline-block;width:14px;height:14px;background:${order.color||'#fff'};border:1px solid #ddd;border-radius:3px;vertical-align:middle"></span>
            ${order.color || '—'}
          </span>
        </td>
      </tr>
      <tr style="border-bottom:1px solid #f0f0f8">
        <td style="padding:10px 0;color:#888;font-size:13px">Quantité</td>
        <td style="padding:10px 0;font-weight:600;font-size:13px;text-align:right">${order.quantity}</td>
      </tr>
      <tr style="border-bottom:2px solid #111">
        <td style="padding:14px 0 10px;color:#888;font-size:13px">Produit (${unitFmt} €) + Format (${extraFmt} €)</td>
        <td style="padding:14px 0 10px;text-align:right"></td>
      </tr>
      <tr>
        <td style="padding:12px 0;font-weight:700;font-size:16px">Total</td>
        <td style="padding:12px 0;font-weight:700;font-size:20px;color:#F59E0B;text-align:right">${totalFmt} €</td>
      </tr>
    </table>

    <!-- Timeline -->
    <div style="background:#f8f8fc;border-radius:12px;padding:20px;margin-bottom:24px">
      <div style="font-size:12px;font-weight:600;color:#333;margin-bottom:14px;text-transform:uppercase;letter-spacing:1px">Suivi de commande</div>
      ${['Commande confirmée ✅','En préparation impression','Expédition','Livraison'].map((step, i) => `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:${i<3?'10px':'0'}">
          <div style="width:24px;height:24px;border-radius:50%;background:${i===0?'#F59E0B':'#e8e8f0'};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:11px;font-weight:700;color:${i===0?'#000':'#aaa'}">${i+1}</div>
          <div style="font-size:13px;color:${i===0?'#111':'#aaa'};font-weight:${i===0?600:400}">${step}</div>
          ${i===0?`<div style="margin-left:auto;font-size:11px;color:#aaa">${dateStr}</div>`:''}
        </div>`).join('')}
    </div>

    <p style="color:#666;font-size:13px;line-height:1.6;margin:0">
      Des questions ? Répondez simplement à cet email, nous sommes là pour vous aider.
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
