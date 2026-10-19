'use strict';

/**
 * routes/app-proxy.js — résolution de l'origin backend servie dans les
 * scripts storefront (tl-modal.js, tl-designs.js, tl-editor.js, tsl-engine.js).
 * ──────────────────────────────────────────────────────────────────────────
 * Bug trouvé le 19/10 (signalé par Alan : plusieurs options storefront
 * activées en admin n'avaient aucun effet visible — resume_design_enabled,
 * email_resume_enabled, cart_edit_design_enabled, same_design_*_enabled…).
 *
 * Ces 4 scripts, servis via l'App Proxy (/apps/textilelab/tl-modal.js etc.),
 * sont réécrits à la volée : l'origin backend EN DUR dans le fichier source
 * (https://textile-studio-production.up.railway.app, celui de l'app publique
 * en review) est remplacé par l'origin RÉEL du backend qui sert cette requête
 * — indispensable en multi-déploiement (app publique vs app Custom par
 * marchand, chacune sur son propre domaine Railway, cf. shopify.app.toml vs
 * shopify.app.winshirt.toml).
 *
 * Ce module ne lisait jusqu'ici QUE `SHOPIFY_APP_URL`, alors que TOUT le
 * reste du code (server.js, routes/designs.js, routes/render.js,
 * routes/email.js, routes/mockup-gen.js) accepte indifféremment `APP_URL` OU
 * `SHOPIFY_APP_URL`. Si le déploiement Railway n'a que `APP_URL` de
 * configuré (et pas `SHOPIFY_APP_URL`), les 4 scripts storefront gardaient
 * silencieusement l'origin EN DUR — chaque flag lu depuis ce mauvais backend
 * retombait sur sa valeur par défaut, quoi qu'Alan ait coché dans son admin.
 *
 * Reproduit et vérifié manuellement ce jour (serveur local, 3 scénarios :
 * SHOPIFY_APP_URL seul, APP_URL seul, aucun des deux) avant ce correctif —
 * voir le rapport de session pour le détail des commandes `curl`.
 *
 * Pas de DOM, pas de chargement du module (routes/app-proxy.js require
 * db/database — même prudence que tests/customer-token.test.js) : câblage
 * source par regex.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../routes/app-proxy.js'), 'utf8');

test('routes/app-proxy.js : resolveAppUrl() accepte APP_URL en priorité, SHOPIFY_APP_URL en repli', () => {
  const start = src.indexOf('function resolveAppUrl(');
  assert.ok(start > -1, 'fonction resolveAppUrl introuvable');
  const section = src.slice(start, start + 400);
  assert.match(section, /process\.env\.APP_URL \|\| process\.env\.SHOPIFY_APP_URL/);
});

test('routes/app-proxy.js : avertit bruyamment (console.error) si ni APP_URL ni SHOPIFY_APP_URL ne sont définis', () => {
  const start = src.indexOf('function resolveAppUrl(');
  const section = src.slice(start, start + 400);
  assert.match(section, /console\.error\(/);
});

test('routes/app-proxy.js : aucune route ne lit plus SHOPIFY_APP_URL seul (sans passer par resolveAppUrl)', () => {
  // La définition de resolveAppUrl() elle-même lit SHOPIFY_APP_URL (en repli)
  // — on exclut cette unique ligne et on vérifie qu'aucune AUTRE occurrence
  // de process.env.SHOPIFY_APP_URL ne subsiste ailleurs dans le fichier.
  const matches = src.match(/process\.env\.SHOPIFY_APP_URL/g) || [];
  assert.equal(matches.length, 1, `attendu 1 seule occurrence (dans resolveAppUrl), trouvé ${matches.length}`);
});

for (const route of ['/', '/editor', '/tl-modal.js', '/tl-designs.js', '/tl-editor.js']) {
  test(`routes/app-proxy.js : la route ${route} résout son appUrl via resolveAppUrl()`, () => {
    const routeStart = src.indexOf(`router.get('${route}', requireProxyHMAC`);
    assert.ok(routeStart > -1, `route ${route} introuvable`);
    const section = src.slice(routeStart, routeStart + 400);
    assert.match(section, /resolveAppUrl\(/);
  });
}

test("routes/app-proxy.js : tsl-engine.js (factorisée dans servirScriptStorefront) résout aussi via resolveAppUrl()", () => {
  const start = src.indexOf('function servirScriptStorefront(');
  assert.ok(start > -1, 'servirScriptStorefront introuvable');
  const section = src.slice(start, start + 400);
  assert.match(section, /resolveAppUrl\(nom\)/);
});
