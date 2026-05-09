'use strict';
/**
 * compositeMockup.js — Compositing PNG via sharp
 * ═══════════════════════════════════════════════════════════════════════════
 * Génère les 5 sorties d'un design pour une commande TextileLab :
 *   - print-front           PNG transparent HD (zone × 300dpi) pour imprimeur
 *   - print-back            idem verso
 *   - mockup-cart           ~400px, drawer panier + checkout
 *   - mockup-email-hero     ~1200px, hero email
 *   - mockup-email-thumb    ~300px carré, vignette email
 *
 * Phase 1 : t-shirt homme blanc, recto + verso uniquement.
 * Le manifest (templates + zones d'impression par produit/couleur/face) est
 * défini dans `mockup-manifest.json` (même dossier).
 *
 * Sources mockups :
 *   /data/mockup-templates/<product>/<color>-<face>.png
 *   ex: /data/mockup-templates/tshirt-homme/white-front.png
 *
 * Sortie :
 *   /data/renders/<design_id>/print-front.png
 *   /data/renders/<design_id>/print-back.png
 *   /data/renders/<design_id>/mockup-cart.png
 *   /data/renders/<design_id>/mockup-email-hero.png
 *   /data/renders/<design_id>/mockup-email-thumb.png
 * ═══════════════════════════════════════════════════════════════════════════
 */

const fs    = require('fs');
const path  = require('path');
const sharp = require('sharp');

const DATA_DIR        = process.env.DATA_DIR || path.join(__dirname, '..');
const TEMPLATES_DIR   = path.join(DATA_DIR, 'mockup-templates');
const RENDERS_DIR     = path.join(DATA_DIR, 'renders');
const MANIFEST_PATH   = path.join(__dirname, 'mockup-manifest.json');

// Tailles de sortie selon le variant demandé
const VARIANT_SIZES = {
  'cart':         { width: 400,  fit: 'inside' },
  'email-hero':   { width: 1200, fit: 'inside' },
  'email-thumb':  { width: 300,  height: 300, fit: 'cover' },
  // 'print' : la taille est déduite du manifest (printZone × 300dpi) au runtime
};

// Cache en mémoire du manifest (rechargé à chaque cold-start)
let _manifestCache = null;
function loadManifest() {
  if (_manifestCache) return _manifestCache;
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Manifest mockup introuvable : ${MANIFEST_PATH}`);
  }
  _manifestCache = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  return _manifestCache;
}

/**
 * compositeMockup — composite un design dans la zone d'un mockup.
 *
 * @param {Object}  opts
 * @param {Buffer}  opts.designPng     PNG transparent du design (généralement à la
 *                                     taille de la zone d'impression × 300dpi)
 * @param {string}  opts.product       'tshirt-homme' | 'tshirt-femme' | 'casquette'
 * @param {string}  opts.color         'white' | 'black' | ...
 * @param {string}  opts.face          'front' | 'back'
 * @param {string}  opts.variant       'print' | 'cart' | 'email-hero' | 'email-thumb'
 * @param {Object} [opts.printZone]    Override { x, y, width, height } en px sur le
 *                                     mockup natif. Si absent → lu dans le manifest.
 * @returns {Promise<{ buffer: Buffer, width: number, height: number, mime: 'image/png' }>}
 */
async function compositeMockup(opts) {
  const { designPng, product, color, face, variant } = opts;

  if (!Buffer.isBuffer(designPng)) {
    throw new Error('compositeMockup: designPng doit être un Buffer');
  }
  if (!['front', 'back'].includes(face)) {
    throw new Error(`compositeMockup: face invalide "${face}" (attendu front|back)`);
  }
  if (!['print', 'cart', 'email-hero', 'email-thumb'].includes(variant)) {
    throw new Error(`compositeMockup: variant invalide "${variant}"`);
  }

  // ── 1. Manifest : trouver le template + la zone d'impression ──
  const manifest = loadManifest();
  const productConf = manifest.products?.[product];
  if (!productConf) throw new Error(`Produit non géré : ${product}`);
  const colorConf = productConf.colors?.[color];
  if (!colorConf) throw new Error(`Couleur non gérée : ${product}/${color}`);
  const faceConf = colorConf.faces?.[face];
  if (!faceConf) throw new Error(`Face non gérée : ${product}/${color}/${face}`);

  const templatePath = path.join(TEMPLATES_DIR, faceConf.template);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template mockup absent du disque : ${templatePath}`);
  }
  const printZone = opts.printZone || faceConf.printZone;
  if (!printZone || !printZone.width || !printZone.height) {
    throw new Error(`printZone manquante pour ${product}/${color}/${face}`);
  }

  // ── 2. Variant 'print' : pas de mockup, juste le PNG HD pour imprimeur ──
  if (variant === 'print') {
    // Le designPng est déjà à la taille zone d'impression × 300dpi.
    // On le passe juste dans sharp() pour normaliser (PNG, alpha conservé).
    const out = await sharp(designPng).png({ compressionLevel: 9 }).toBuffer();
    const meta = await sharp(out).metadata();
    return { buffer: out, width: meta.width, height: meta.height, mime: 'image/png' };
  }

  // ── 3. Variants mockup : composite design dans la zone du template ──
  const designResized = await sharp(designPng)
    .resize(printZone.width, printZone.height, { fit: 'inside', withoutEnlargement: false })
    .png()
    .toBuffer();

  const mockupComposed = await sharp(templatePath)
    .composite([{
      input: designResized,
      left:  Math.round(printZone.x),
      top:   Math.round(printZone.y),
    }])
    .png()
    .toBuffer();

  // ── 4. Resize selon le variant demandé ──
  const sizeOpts = VARIANT_SIZES[variant];
  const finalBuf = await sharp(mockupComposed)
    .resize({
      width:  sizeOpts.width,
      height: sizeOpts.height,
      fit:    sizeOpts.fit,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();

  const meta = await sharp(finalBuf).metadata();
  return { buffer: finalBuf, width: meta.width, height: meta.height, mime: 'image/png' };
}

/**
 * generateAllMockups — orchestre les 5 sorties pour un design + variant produit.
 *
 * @param {Object} opts
 * @param {number} opts.designId       PK Designs en DB
 * @param {Buffer} opts.designFront    PNG transparent du design recto
 * @param {Buffer} [opts.designBack]   PNG transparent du design verso (optionnel)
 * @param {string} opts.product        'tshirt-homme' | ...
 * @param {string} opts.color          'white' | ...
 * @returns {Promise<{ paths: Object<string, string>, errors: Array }>}
 */
async function generateAllMockups({ designId, designFront, designBack, product, color }) {
  const dir = path.join(RENDERS_DIR, String(designId));
  fs.mkdirSync(dir, { recursive: true });

  const paths  = {};
  const errors = [];

  // Outputs à générer : (key → variant + face + designBuffer)
  const jobs = [
    { key: 'print-front',        variant: 'print',       face: 'front', buf: designFront },
    { key: 'mockup-cart',        variant: 'cart',        face: 'front', buf: designFront },
    { key: 'mockup-email-hero',  variant: 'email-hero',  face: 'front', buf: designFront },
    { key: 'mockup-email-thumb', variant: 'email-thumb', face: 'front', buf: designFront },
  ];
  if (designBack) {
    jobs.push({ key: 'print-back', variant: 'print', face: 'back', buf: designBack });
  }

  for (const job of jobs) {
    try {
      const { buffer } = await compositeMockup({
        designPng: job.buf,
        product, color, face: job.face, variant: job.variant,
      });
      const filepath = path.join(dir, `${job.key}.png`);
      fs.writeFileSync(filepath, buffer);
      paths[job.key] = filepath;
    } catch (err) {
      errors.push({ key: job.key, error: err.message });
    }
  }

  return { paths, errors };
}

module.exports = {
  compositeMockup,
  generateAllMockups,
  loadManifest,
};
