'use strict';
/**
 * utils/print-composition.js — Fichier d'impression d'une composition.
 * ──────────────────────────────────────────────────────────────────────────
 * Le client compose dans le navigateur, mais le fichier qui part chez
 * l'imprimeur se fabrique ICI. Deux raisons, et la seconde est la plus
 * importante :
 *
 *   • un PNG 300 dpi en A3 pèse plusieurs mégaoctets ; le faire transiter
 *     depuis le navigateur à chaque ajout au panier est intenable ;
 *   • surtout, un fichier produit par le navigateur n'est pas vérifiable.
 *     Reconstruire depuis la composition enregistrée garantit que ce qu'on
 *     imprime correspond à ce qui a été commandé, et pas à ce qu'un client
 *     aurait pu glisser dans la requête.
 *
 * Complète utils/print-file.js, qui traite le cas d'un visuel unique choisi
 * sur la fiche produit. Ici on rend une composition complète : plusieurs
 * calques, textes compris, dans l'ordre d'empilement.
 *
 * Le placement vient de utils/composition.js — la MÊME arithmétique que
 * l'écran. C'est ce qui garantit que le fichier imprimé reproduit l'aperçu :
 * si les deux divisaient le calcul, ils divergeraient au premier arrondi.
 */

const COMP = require('./composition');
const { FORMATS_MM, FORMAT_PAR_DEFAUT } = require('./design-library');

const DPI = 300;

// ── Polices ───────────────────────────────────────────────────────────────
// Le rendu serveur n'a pas les polices du navigateur. Sur ma machine
// « sans-serif » n'est même pas une famille enregistrée : le moteur retombait
// sur une police de dernier recours et sortait des carrés à la place des
// accents — rédhibitoire pour une boutique française. Et sur Railway, un
// conteneur Linux n'a souvent AUCUNE police installée.
//
// Deux parades, dans cet ordre :
//   1. toute police déposée dans <DATA_DIR>/fonts ou <projet>/fonts est
//      enregistrée au démarrage. C'est le moyen d'avoir en production
//      exactement les polices proposées au client ;
//   2. à défaut, on résout la famille demandée contre celles que l'hôte
//      possède réellement, par une chaîne de repli — et jamais vers une
//      famille incapable d'afficher un « é ».
// La police embarquée vient en TÊTE : sur un hôte sans police, les suivantes
// n'existent pas, et sur un hôte qui en a, la sienne peut être incomplète.
const REPLIS = ['TSL Montserrat', 'Montserrat', 'Helvetica Neue', 'Helvetica',
                'Arial', 'DejaVu Sans', 'Liberation Sans', 'Noto Sans', 'Verdana'];
let _polices = null;
let _dejaSignale = false;

// Préfixe réservé aux polices que NOUS enregistrons, pour qu'une police du
// système portant le même nom ne les masque jamais.
const ALIAS_PREFIXE = 'TSL ';

/**
 * Nom réservé d'une famille.
 *
 * Un seul nom, sans déclinaison de graisse : @napi-rs/canvas ne garde qu'une
 * fonte par nom de famille ET lit mal le nom interne des WOFF2 de Google —
 * deux fichiers de graisses différentes y atterrissent sous la même famille.
 * Le gras est donc synthétisé au dessin (cf. _dessinerTexte) plutôt que
 * cherché dans une seconde fonte qu'on ne saurait pas adresser.
 */
function _alias(nom) {
  return ALIAS_PREFIXE + nom;
}

function _chargerPolices() {
  if (_polices) return _polices;
  const { GlobalFonts } = require('@napi-rs/canvas');
  const fs = require('fs');
  const path = require('path');

  // La police EMBARQUÉE d'abord, et sous son nom réservé.
  //
  // Un conteneur Linux n'a pas de police utilisable : le premier rendu en
  // production est sorti entièrement en carrés, alors que tout fonctionnait
  // en local. Le téléchargement à la demande ne suffit donc pas comme seul
  // filet — il dépend du réseau au moment précis où l'on imprime. Montserrat
  // est embarquée pour que le texte sorte toujours.
  //
  // TTF et non WOFF2 : la version Linux de la bibliothèque ne décompresse
  // pas le Brotli du WOFF2. La police s'enregistrait sans erreur et rendait
  // quand même des carrés — un échec parfaitement silencieux.
  const embarquees = path.join(__dirname, '..', 'assets', 'fonts');
  if (fs.existsSync(embarquees)) {
    for (const f of fs.readdirSync(embarquees)) {
      if (!/\.(ttf|otf)$/i.test(f)) continue;
      const famille = f.split('-')[0];
      try { GlobalFonts.registerFromPath(path.join(embarquees, f), ALIAS_PREFIXE + famille); } catch {}
    }
  }

  [process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'fonts') : null,
   path.join(process.env.DATA_DIR || require('os').tmpdir(), 'tsl-fonts')].forEach((dir) => {
    if (!dir || !fs.existsSync(dir)) return;
    try {
      const n = GlobalFonts.loadFontsFromDir(dir);
      if (n) console.log(`[impression] ${n} police(s) chargée(s) depuis ${dir}`);
    } catch (e) { console.warn('[impression] polices ignorées :', e.message); }
  });

  const premiereFois = !_dejaSignale;
  _dejaSignale = true;
  // Une famille n'est tenue pour disponible que si elle offre une graisse
  // normale. Le Montserrat installé sur un Mac, par exemple, ne contient que
  // du Thin 100 : s'y fier imprimait tous les textes en filet, gras compris,
  // et empêchait d'aller chercher la vraie police.
  // Les familles que NOUS enregistrons échappent au filtre : la fonte
  // variable embarquée déclare la graisse minimale de son axe (100), et le
  // filtre l'écartait donc comme il écarte un Thin de système — en laissant
  // croire que la police embarquée était introuvable.
  const dispo = new Set(GlobalFonts.families
    .filter((f) => f.family.startsWith(ALIAS_PREFIXE)
                || (f.styles || []).some((st) => Number(st.weight) >= 400))
    .map((f) => f.family));
  const defaut = REPLIS.find((f) => dispo.has(f)) || GlobalFonts.families[0]?.family || null;
  if (!defaut) {
    if (premiereFois) console.warn('[impression] AUCUNE police disponible : les textes ne seront pas rendus.');
  } else if (premiereFois && !dispo.has('TSL Montserrat')) {
    console.warn(`[impression] police embarquée introuvable, repli sur « ${defaut} ».`);
  }
  _polices = { dispo, defaut };
  return _polices;
}

/**
 * Famille demandée → famille réellement disponible.
 * Une famille absente rendrait des carrés à la place des accents, en
 * silence : mieux vaut un repli lisible qu'un fichier d'impression illisible.
 */
function resoudrePolice(demandee) {
  const { dispo, defaut } = _chargerPolices();
  const nom = _nomFamille(demandee);
  if (nom && dispo.has(nom)) return nom;
  return defaut;
}

function _nomFamille(v) {
  return String(v || '').split(',')[0].trim().replace(/^["']|["']$/g, '');
}

// Téléchargements en cours, pour que deux rendus simultanés de la même
// police n'aillent pas la chercher deux fois.
const _enRoute = new Map();
// Famille demandée → famille réellement utilisée au dessin.
const _resolues = {};

/**
 * Garantit qu'une police est disponible, en la récupérant au besoin.
 * ──────────────────────────────────────────────────────────────────────────
 * Le studio propose une trentaine de polices Google. Les embarquer toutes,
 * avec leurs graisses, pèserait des dizaines de mégaoctets dans le dépôt ;
 * s'en passer imprimerait le texte d'un client dans une police qu'il n'a pas
 * choisie. On les récupère donc à la demande et on les garde sur disque :
 * un appel réseau par police, une seule fois dans la vie du serveur.
 *
 * Les graisses 400 ET 700 sont demandées — sans la seconde, le gras d'un
 * client s'imprime fin, ce qui est passé inaperçu au premier essai parce que
 * le Montserrat du système ne contenait qu'une graisse.
 *
 * @returns {Promise<string|null>} la famille utilisable, ou le repli
 */
async function assurerPolice(demandee) {
  const nom = _nomFamille(demandee);
  if (!nom) return resoudrePolice(nom);
  const { dispo } = _chargerPolices();
  // La version que NOUS avons récupérée l'emporte toujours sur celle du
  // système, qui peut être incomplète.
  if (dispo.has(_alias(nom))) return _alias(nom);
  if (dispo.has(nom)) return nom;
  if (_enRoute.has(nom)) return _enRoute.get(nom);

  const promesse = _telechargerPolice(nom)
    .then((ok) => (ok ? _alias(nom) : resoudrePolice(nom)))
    .catch(() => resoudrePolice(nom))
    .finally(() => _enRoute.delete(nom));
  _enRoute.set(nom, promesse);
  return promesse;
}

async function _telechargerPolice(nom) {
  const fs = require('fs');
  const path = require('path');
  const { GlobalFonts } = require('@napi-rs/canvas');

  // Toujours sur le volume de données, jamais dans le dépôt : sans DATA_DIR,
  // un premier essai a déposé les polices téléchargées à la racine du projet.
  const dossier = path.join(process.env.DATA_DIR || require('os').tmpdir(), 'tsl-fonts');
  await fs.promises.mkdir(dossier, { recursive: true });

  // Un fichier déjà en cache suffit : pas de réseau.
  const prefixe = nom.toLowerCase().replace(/\s+/g, '') + '-';
  const deja = (await fs.promises.readdir(dossier).catch(() => []))
    .filter((f) => f.toLowerCase().startsWith(prefixe));
  if (deja.length) {
    deja.forEach((f) => {
      try { GlobalFonts.registerFromPath(path.join(dossier, f), _alias(nom)); } catch {}
    });
    _polices = null; // forcer la relecture des familles
    return true;
  }

  // WOFF2 statique, UNE REQUÊTE PAR GRAISSE, via l'API v1.
  //
  // Trois pièges successifs ont mené ici, et ils méritent d'être notés :
  //
  //  1. un User-Agent d'Internet Explorer 6, censé obtenir du TrueType,
  //     faisait en réalité servir de l'EOT — illisible par le moteur, et
  //     l'enregistrement échouait en silence ;
  //  2. l'API v2 renvoie, pour Montserrat, LE MÊME FICHIER pour 400 et 700 :
  //     c'est une police variable, une seule fonte couvrant tout l'axe de
  //     graisse. Le moteur serveur n'exploite pas cet axe, si bien que le
  //     gras d'un client sortait identique au romain ;
  //  3. l'API v1, elle, sert des fontes STATIQUES, un fichier par graisse.
  //
  // @napi-rs/canvas ne gardant qu'une fonte par nom de famille, chaque
  // graisse est enregistrée sous son propre nom (cf. _alias).
  const ua = { 'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' };
  const base = 'https://fonts.googleapis.com/css?family='
             + encodeURIComponent(nom).replace(/%20/g, '+');

  let n = 0;
  for (const poids of [400]) {
    try {
      const r = await fetch(`${base}:${poids}`, { headers: ua });
      if (!r.ok) continue;
      const css = await r.text();

      // Le CSS découpe chaque graisse en sous-ensembles (latin, cyrillique,
      // grec, vietnamien…). On ne garde que le latin : les autres pèseraient
      // pour rien, et « latin » suffit aux accents français.
      const blocs = [...css.matchAll(/\/\*\s*([a-z0-9-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/gi)]
        .filter((b) => /^latin(-ext)?$/i.test(b[1]));
      const corps = blocs.length ? blocs.map((b) => b[2])
                                 : [...css.matchAll(/@font-face\s*\{([^}]*)\}/gi)].map((m) => m[1]);

      for (let k = 0; k < corps.length; k++) {
        const lien = (corps[k].match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/i) || [])[1];
        if (!lien) continue;
        const res = await fetch(lien, { headers: ua });
        if (!res.ok) continue;
        const fichier = path.join(dossier, `${nom.replace(/\s+/g, '')}-${poids}-${k}.woff2`);
        await fs.promises.writeFile(fichier, Buffer.from(await res.arrayBuffer()));
        // registerFromPath rend false quand le fichier n'est pas lisible : on
        // ne compte que les vraies réussites, sinon l'échec repasse inaperçu.
        if (GlobalFonts.registerFromPath(fichier, _alias(nom))) n++;
        else await fs.promises.unlink(fichier).catch(() => {});
      }
    } catch { /* graisse indisponible : on garde celles qu'on a */ }
  }
  if (!n) throw new Error('aucun fichier exploitable pour ' + nom);
  console.log(`[impression] police « ${nom} » récupérée (${n} graisse(s))`);
  _polices = null;
  return true;
}

/** Dimensions du fichier d'impression pour un format, orienté comme la zone. */
function tailleImpression(format, ratioZone, dpi = DPI) {
  const f = FORMATS_MM[format] ? format : FORMAT_PAR_DEFAUT;
  const { w: mmW, h: mmH } = FORMATS_MM[f];
  // La zone commande l'orientation : une zone large (sac) imprime en paysage.
  const paysage = Number(ratioZone) > 1;
  const largeurMm = paysage ? mmH : mmW;
  const hauteurMm = paysage ? mmW : mmH;
  return {
    w: Math.round((largeurMm / 25.4) * dpi),
    h: Math.round((hauteurMm / 25.4) * dpi),
    format: f,
    paysage,
  };
}

/**
 * Récupère les octets d'une source de calque.
 *
 * Les compositions viennent du NAVIGATEUR D'UN CLIENT : leurs sources sont
 * des données non fiables. Lire un chemin local arbitraire laisserait donc
 * n'importe qui faire ouvrir n'importe quel fichier du serveur en glissant
 * `../../..` dans un calque. Seuls les fichiers de /uploads sont acceptés,
 * et on revérifie APRÈS résolution que le chemin n'est pas sorti du dossier
 * — un contrôle sur la chaîne d'entrée se contourne de trop de façons.
 */
async function _octets(src, racineLocale) {
  const path = require('path');
  const fs = require('fs');
  const s = String(src || '');

  if (/^data:image\//i.test(s)) {
    return Buffer.from(s.replace(/^data:image\/\w+;base64,/, ''), 'base64');
  }
  if (/^https?:\/\//i.test(s)) {
    const r = await fetch(s);
    if (!r.ok) throw new Error(`source HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }

  const racine = path.resolve(racineLocale || process.env.DATA_DIR || process.cwd());
  const dossier = path.join(racine, 'uploads');
  const vise = path.resolve(racine, '.' + (s.startsWith('/') ? s : '/' + s));
  if (vise !== dossier && !vise.startsWith(dossier + path.sep)) {
    throw new Error('source locale hors du dossier des visuels');
  }
  return fs.promises.readFile(vise);
}

/**
 * Rend une face d'une composition en PNG prêt pour l'impression.
 *
 * @param {object} composition  au format utils/composition.js
 * @param {string} face         'front' ou 'back'
 * @param {object} [opts]
 *        format       A6/A5/A4/A3 ; sinon celui de la face, sinon le défaut
 *        dpi
 *        racineLocale pour les sources en chemin relatif
 * @returns {Promise<{buffer:Buffer, w:number, h:number, format:string, calques:number}|null>}
 *          null si la face est vide — il n'y a alors rien à imprimer
 */
async function rendreFace(composition, face, opts = {}) {
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  const c = COMP.normaliser(composition);
  const f = c.faces[face];
  if (!f || !f.layers.length) return null;

  const visibles = f.layers.filter((l) => l.visible);
  if (!visibles.length) return null;

  // Les polices doivent être prêtes avant le premier fillText : les récupérer
  // en plein dessin donnerait un fichier à moitié rendu.
  const familles = [...new Set(visibles
    .filter((l) => l.type === 'text')
    .map((l) => (l.fabric && l.fabric.fontFamily) || ''))].filter(Boolean);
  for (const fam of familles) {
    try { _resolues[_nomFamille(fam)] = await assurerPolice(fam); }
    catch { /* repli géré à la résolution */ }
  }

  const ratioZone = f.zone && f.zone.ratio > 0 ? f.zone.ratio : 1;
  const taille = tailleImpression(opts.format || f.format, ratioZone, opts.dpi || DPI);

  const canvas = createCanvas(taille.w, taille.h);
  const ctx = canvas.getContext('2d');
  // Fond transparent : seule l'encre doit être imprimée.

  // La zone de référence du rendu EST le canevas entier : les positions sont
  // relatives, donc le même calcul que l'écran, à une autre échelle.
  const zone = { x: 0, y: 0, w: taille.w, h: taille.h };

  for (const calque of visibles) {
    const boite = COMP.versPixels(calque, zone);
    ctx.save();
    ctx.globalAlpha = calque.opacity;
    // Rotation autour du centre du calque, comme à l'écran.
    if (calque.angle) {
      ctx.translate(boite.left + boite.width / 2, boite.top + boite.height / 2);
      ctx.rotate((calque.angle * Math.PI) / 180);
      ctx.translate(-(boite.left + boite.width / 2), -(boite.top + boite.height / 2));
    }

    try {
      if (calque.type === 'text') {
        _dessinerTexte(ctx, calque, boite);
      } else {
        const src = calque.fabric && calque.fabric.src;
        if (src) {
          const img = await loadImage(await _octets(src, opts.racineLocale));
          ctx.drawImage(img, boite.left, boite.top, boite.width, boite.height);
        }
      }
    } catch (e) {
      // Un calque illisible ne doit pas faire perdre toute la commande : on
      // le saute et on le signale dans le résultat.
      if (!opts._manques) opts._manques = [];
      opts._manques.push({ id: calque.id, raison: e.message });
    }
    ctx.restore();
  }

  return {
    buffer:  canvas.toBuffer('image/png'),
    w:       taille.w,
    h:       taille.h,
    format:  taille.format,
    calques: visibles.length,
    manques: opts._manques || [],
  };
}

/**
 * Dessine un calque texte à la taille voulue.
 *
 * La taille de police n'est pas reprise telle quelle : à l'écran elle est en
 * pixels de canevas, ici en pixels d'impression, et le rapport entre les deux
 * dépend de la définition. On la déduit donc de la HAUTEUR allouée au calque,
 * ce qui reproduit fidèlement ce que le client a vu, quelle que soit la
 * taille de son écran.
 */
function _dessinerTexte(ctx, calque, boite) {
  const f = calque.fabric || {};
  const lignes = String(f.text != null ? f.text : '').split('\n');
  const hauteurLigne = boite.height / Math.max(1, lignes.length);
  const taille = Math.max(1, Math.round(hauteurLigne * 0.78)); // ~hauteur de capitale

  const italique = f.fontStyle === 'italic' ? 'italic ' : '';
  // assurerPolice a déjà tourné en amont : on relit sa résolution, qui peut
  // pointer vers notre propre copie plutôt que vers la police du système.
  let famille = _resolues[_nomFamille(f.fontFamily)] || resoudrePolice(f.fontFamily);
  if (!famille) return; // aucune police sur l'hôte : on ne dessine rien plutôt que des carrés

  ctx.font = `${italique}${taille}px "${famille}"`;

  // GRAS SYNTHÉTIQUE.
  //
  // Le mot-clé `bold` reste sans effet ici : @napi-rs/canvas ne garde qu'une
  // fonte par nom de famille, et lit mal le nom interne des WOFF2 de Google —
  // deux graisses distinctes y atterrissent sous la même famille et rendent
  // à l'identique. Vérifié en comparant les pixels encrés de deux fichiers
  // pourtant différents.
  //
  // On épaissit donc le tracé, technique classique : un contour de la même
  // couleur, d'une épaisseur proportionnelle au corps. Le résultat est
  // prévisible avec n'importe quelle police, y compris celles du système.
  const veutGras = String(f.fontWeight || '') === 'bold' || Number(f.fontWeight) >= 600;
  const epaisseur = veutGras ? Math.max(1, taille * 0.045) : 0;
  ctx.fillStyle = f.fill || '#000000';
  ctx.textBaseline = 'top';

  const align = f.textAlign || 'center';
  ctx.textAlign = align === 'left' ? 'left' : align === 'right' ? 'right' : 'center';
  const x = align === 'left' ? boite.left
          : align === 'right' ? boite.left + boite.width
          : boite.left + boite.width / 2;

  if (epaisseur) {
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = epaisseur;
    ctx.lineJoin = 'round';
  }
  lignes.forEach((ligne, i) => {
    const y = boite.top + i * hauteurLigne;
    if (epaisseur) ctx.strokeText(ligne, x, y);
    ctx.fillText(ligne, x, y);
  });
}

/**
 * Rend toutes les faces personnalisées d'une composition.
 * @returns {Promise<Object<string, object>>} face → résultat de rendreFace
 */
async function rendreToutesLesFaces(composition, opts = {}) {
  const out = {};
  for (const face of COMP.facesUtilisees(composition)) {
    const r = await rendreFace(composition, face, Object.assign({}, opts));
    if (r) out[face] = r;
  }
  return out;
}

/** État des polices, pour diagnostic depuis /api/version. */
function etatPolices() {
  const { dispo, defaut } = _chargerPolices();
  return { total: dispo.size, defaut, embarquee: dispo.has('TSL Montserrat') };
}

module.exports = { DPI, tailleImpression, rendreFace, rendreToutesLesFaces,
                   resoudrePolice, assurerPolice, etatPolices };
