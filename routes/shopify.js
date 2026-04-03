'use strict';
/**
 * routes/shopify.js — Webhooks Shopify
 * ─────────────────────────────────────
 *  POST /shopify/webhook
 *    Dispatcher principal (orders/paid + app/uninstalled)
 *    Vérifie HMAC avec SHOPIFY_WEBHOOK_SECRET ou SHOPIFY_API_SECRET
 *
 *  POST /shopify/gdpr/customers/data_request   ← OBLIGATOIRE App Store
 *  POST /shopify/gdpr/customers/redact         ← OBLIGATOIRE App Store
 *  POST /shopify/gdpr/shop/redact              ← OBLIGATOIRE App Store
 *    Vérifient HMAC avec SHOPIFY_API_SECRET (Shopify signe ces webhooks avec le Client Secret)
 */
const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const { getDB } = require('../db/database');

// Raw body obligatoire AVANT tout json middleware — nécessaire pour HMAC
router.use(express.raw({ type: 'application/json' }));

// ── Vérification HMAC — essaie les deux secrets possibles ────────────────────
// Shopify signe les webhooks manuels  avec SHOPIFY_WEBHOOK_SECRET
// Shopify signe les webhooks GDPR/app avec SHOPIFY_API_SECRET (Client Secret)
function _verifyHMAC(rawBody, incomingHmac, ...secrets) {
  for (const secret of secrets) {
    if (!secret) continue;
    const hash = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('base64');
    try {
      if (crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(incomingHmac))) {
        return true;
      }
    } catch { /* longueurs différentes — continuer */ }
  }
  return false;
}

function verifyShopifyHMAC(req) {
  const hmac = req.headers['x-shopify-hmac-sha256'];
  if (!hmac) return false;
  const secret1 = process.env.SHOPIFY_WEBHOOK_SECRET || '';
  const secret2 = process.env.SHOPIFY_API_SECRET     || '';
  // En dev sans aucun secret configuré, on laisse passer
  if (!secret1 && !secret2) return true;
  return _verifyHMAC(req.body, hmac, secret1, secret2);
}

function verifyGDPRHMAC(req) {
  const hmac = req.headers['x-shopify-hmac-sha256'];
  if (!hmac) return false;
  const secret = process.env.SHOPIFY_API_SECRET || '';
  // En dev sans secret configuré, on laisse passer
  if (!secret) return true;
  return _verifyHMAC(req.body, hmac, secret);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /shopify/webhook — dispatcher principal
// ─────────────────────────────────────────────────────────────────────────────
router.post('/webhook', (req, res) => {
  if (!verifyShopifyHMAC(req)) {
    console.warn('⚠️  Shopify webhook: HMAC invalide');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString());
  } catch {
    return res.status(400).json({ error: 'Bad JSON' });
  }

  const topic = req.headers['x-shopify-topic'] || '';
  const shop  = req.headers['x-shopify-shop-domain'] || '';
  console.log(`📦  Shopify webhook: [${topic}] shop=${shop}`);

  // Dispatch par topic
  if (topic === 'orders/paid')      handleOrderPaid(payload, shop);
  if (topic === 'app/uninstalled')  handleAppUninstalled(payload, shop);

  // Shopify exige un 200 rapide (< 5 s)
  res.status(200).send('OK');
});

// ─────────────────────────────────────────────────────────────────────────────
// GDPR — POST /shopify/gdpr/customers/data_request
// Shopify demande quelles données perso on détient sur un client
// ─────────────────────────────────────────────────────────────────────────────
router.post('/gdpr/customers/data_request', (req, res) => {
  if (!verifyGDPRHMAC(req)) {
    console.warn('⚠️  GDPR customers/data_request: HMAC invalide');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let payload;
  try { payload = JSON.parse(req.body.toString()); } catch { payload = {}; }

  const shop     = req.headers['x-shopify-shop-domain'] || payload.shop_domain || '';
  const customer = payload.customer || {};
  console.log(`📋  GDPR data_request — shop: ${shop}, customer: ${customer.email || customer.id}`);

  // TODO (Phase 2) : envoyer les données au customer.data_request.data_request_url
  // Pour l'instant : log + 200 (conforme à l'exigence Shopify)

  res.status(200).send('OK');
});

// ─────────────────────────────────────────────────────────────────────────────
// GDPR — POST /shopify/gdpr/customers/redact
// Shopify demande la suppression des données perso d'un client
// ─────────────────────────────────────────────────────────────────────────────
router.post('/gdpr/customers/redact', (req, res) => {
  if (!verifyGDPRHMAC(req)) {
    console.warn('⚠️  GDPR customers/redact: HMAC invalide');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let payload;
  try { payload = JSON.parse(req.body.toString()); } catch { payload = {}; }

  const shop     = req.headers['x-shopify-shop-domain'] || payload.shop_domain || '';
  const customer = payload.customer || {};
  const ordersToRedact = payload.orders_to_redact || [];
  console.log(`🗑️  GDPR customers/redact — shop: ${shop}, customer: ${customer.email || customer.id}, orders: ${ordersToRedact.length}`);

  // Anonymiser les données client dans la table orders
  try {
    const db = getDB();
    const shopifyCustomerId = String(customer.id || '');

    if (ordersToRedact.length > 0) {
      // Anonymiser uniquement les commandes listées
      for (const orderId of ordersToRedact) {
        db.prepare(`
          UPDATE orders
          SET customer_name  = '[REDACTED]',
              customer_email = '[REDACTED]',
              notes          = '[REDACTED - GDPR]'
          WHERE shopify_id = ?
        `).run(String(orderId));
      }
    } else if (shopifyCustomerId) {
      // Aucune commande spécifique : anonymiser toutes les commandes du client
      // (on ne stocke pas le shopify_customer_id → on utilise l'email)
      const email = customer.email || '';
      if (email) {
        db.prepare(`
          UPDATE orders
          SET customer_name  = '[REDACTED]',
              customer_email = '[REDACTED]',
              notes          = '[REDACTED - GDPR]'
          WHERE customer_email = ?
        `).run(email);
      }
    }

    console.log(`✅  GDPR customers/redact — anonymisation terminée pour shop: ${shop}`);
  } catch (err) {
    console.error('❌  GDPR customers/redact — DB error:', err.message);
    // Répondre 200 quand même (Shopify réessaiera si 5xx, risque de loop)
  }

  res.status(200).send('OK');
});

// ─────────────────────────────────────────────────────────────────────────────
// GDPR — POST /shopify/gdpr/shop/redact
// Shopify demande la suppression de TOUTES les données d'un shop
// (envoyé ~48h après app/uninstalled)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/gdpr/shop/redact', (req, res) => {
  if (!verifyGDPRHMAC(req)) {
    console.warn('⚠️  GDPR shop/redact: HMAC invalide');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let payload;
  try { payload = JSON.parse(req.body.toString()); } catch { payload = {}; }

  const shop = req.headers['x-shopify-shop-domain'] || payload.shop_domain || '';
  console.log(`🗑️  GDPR shop/redact — suppression définitive pour shop: ${shop}`);

  // Supprimer l'entrée shop (token, etc.) de la DB
  try {
    const db = getDB();
    db.prepare(`DELETE FROM shops WHERE shop_domain = ?`).run(shop);
    console.log(`✅  GDPR shop/redact — shop ${shop} supprimé de la DB`);
  } catch (err) {
    console.error('❌  GDPR shop/redact — DB error:', err.message);
  }

  res.status(200).send('OK');
});

// ─────────────────────────────────────────────────────────────────────────────
// Handler — app/uninstalled
// Marque le shop inactif en DB (l'access_token reste pour le GDPR shop/redact)
// ─────────────────────────────────────────────────────────────────────────────
function handleAppUninstalled(payload, shopDomain) {
  const shop = shopDomain || payload.domain || '';
  if (!shop) return;
  try {
    const db = getDB();
    db.prepare(`
      UPDATE shops
      SET is_active      = 0,
          uninstalled_at = datetime('now')
      WHERE shop_domain = ?
    `).run(shop);
    console.log(`🔌  app/uninstalled — shop ${shop} désactivé en DB`);
  } catch (err) {
    console.error('❌  app/uninstalled — DB error:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler — orders/paid
// ─────────────────────────────────────────────────────────────────────────────
function handleOrderPaid(payload) {
  const db = getDB();

  // Extract design_id from order note attributes or line item properties
  const attrs = payload.note_attributes || [];
  const designAttr = attrs.find(a => a.name === 'design_id');
  const design_id  = designAttr ? parseInt(designAttr.value) : null;

  // Extract product and format from first line item
  const lineItem   = payload.line_items?.[0] || {};
  const properties = lineItem.properties || [];
  const getP = (name) => properties.find(p => p.name === name)?.value || '';

  const product  = getP('product')  || lineItem.sku?.split('-')[0] || 'tshirt';
  const format   = getP('format')   || 'A4';
  const color    = getP('color')    || '#FFFFFF';
  const quantity = lineItem.quantity || 1;

  const customer     = payload.customer || {};
  const address      = payload.billing_address || {};
  const customerName  = `${customer.first_name || ''} ${customer.last_name  || ''}`.trim();
  const customerEmail = customer.email || payload.email || '';

  const unitPrice   = parseFloat(lineItem.price) || 0;
  const formatPrice = parseFloat(getP('format_price')) || 0;
  const totalPrice  = parseFloat(payload.total_price) || unitPrice * quantity;

  const info = db.prepare(`
    INSERT INTO orders
      (shopify_id, design_id, product, color, format, quantity,
       unit_price, format_price, total_price,
       customer_name, customer_email, status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'confirmed')
  `).run(
    String(payload.id), design_id, product, color, format, quantity,
    unitPrice, formatPrice, totalPrice,
    customerName, customerEmail
  );

  const newOrderId = info.lastInsertRowid;
  console.log(`✅  Order #${newOrderId} from ${customerEmail} saved (design #${design_id})`);

  // Envoyer l'email de confirmation automatiquement
  if (customerEmail) {
    const { sendEmail, buildOrderConfirmationHTML } = require('./email');
    const newOrder = db.prepare('SELECT * FROM orders WHERE id=?').get(newOrderId);
    const design   = design_id ? db.prepare('SELECT * FROM designs WHERE id=?').get(design_id) : null;
    sendEmail({
      to: customerEmail,
      subject: `✅ Votre commande TextileLab #${newOrderId} est confirmée`,
      html: buildOrderConfirmationHTML(newOrder, design),
    }).catch(err => console.error('Email send failed:', err.message));
  }
}

// ── TEMP DEV ROUTE — récupère le token admin pour setup (à supprimer après) ──
const { requireAuth } = require('./auth');
const { getShop }     = require('../db/database');
router.get('/dev-token', requireAuth, (req, res) => {
  const record = getShop('textile-studio-lab.myshopify.com');
  if (!record) return res.status(404).json({ error: 'Shop non trouvé' });
  res.json({ shop: record.shop_domain, token: record.access_token });
});

module.exports = router;
