'use strict';

/**
 * Quota de générations IA.
 *   visiteur non connecté : 1 / mois — puis invitation à se connecter
 *   client connecté       : 3 / mois
 *   un achat recharge le compteur dans les deux cas
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../utils/ai-quota');

const SEPT = new Date('2026-09-15T10:00:00Z');
const OCT  = new Date('2026-10-02T10:00:00Z');

test('un visiteur non connecté a une seule génération, puis on lui demande de se connecter', () => {
  const neuf = Q.evaluate(null, 'anonymous', SEPT);
  assert.equal(neuf.allowed, true);
  assert.equal(neuf.limit, 1);
  assert.equal(neuf.remaining, 1);

  const apres = Q.evaluate({ used: 1, period: '2026-09' }, 'anonymous', SEPT);
  assert.equal(apres.allowed, false);
  assert.equal(apres.needsLogin, true, 'la porte de sortie est la connexion');
  assert.match(Q.refusalMessage(apres), /Connectez-vous/);
});

test('un client connecté en a trois', () => {
  for (const used of [0, 1, 2]) {
    const s = Q.evaluate({ used, period: '2026-09' }, 'customer', SEPT);
    assert.equal(s.allowed, true, `used=${used}`);
    assert.equal(s.remaining, 3 - used);
  }
  const epuise = Q.evaluate({ used: 3, period: '2026-09' }, 'customer', SEPT);
  assert.equal(epuise.allowed, false);
  assert.equal(epuise.needsLogin, false, 'déjà connecté : se connecter ne sert à rien');
  assert.match(Q.refusalMessage(epuise), /après un achat, ou le mois prochain/);
});

test('le compteur repart au mois suivant', () => {
  const epuiseEnSeptembre = { used: 3, period: '2026-09' };
  assert.equal(Q.evaluate(epuiseEnSeptembre, 'customer', SEPT).allowed, false);
  const enOctobre = Q.evaluate(epuiseEnSeptembre, 'customer', OCT);
  assert.equal(enOctobre.allowed, true);
  assert.equal(enOctobre.used, 0);
  assert.equal(enOctobre.period, '2026-10');
});

test('un achat rend le quota PLEIN, pas une seule génération', () => {
  // Le rechargement remet used à 0 en base (grantAiQuotaOnOrder) : le client
  // doit alors retrouver ses 3 générations, pas une.
  const apresAchat = { used: 0, period: '2026-09', last_order_period: '2026-09' };
  let etat = Q.evaluate(apresAchat, 'customer', SEPT);
  assert.equal(etat.allowed, true);
  assert.equal(etat.remaining, 3, 'quota plein après achat');

  // On les consomme une à une : 3 possibles, la 4e refusée.
  const suite = [];
  let used = 0;
  for (let i = 0; i < 4; i++) {
    etat = Q.evaluate({ used, period: '2026-09' }, 'customer', SEPT);
    suite.push(etat.allowed);
    if (etat.allowed) used++;
  }
  assert.deepEqual(suite, [true, true, true, false]);

  // Idem pour un visiteur reconnu par l'e-mail de sa commande : il retrouve 1.
  const anonApresAchat = { used: 0, period: '2026-09', last_order_period: '2026-09' };
  assert.equal(Q.evaluate(anonApresAchat, 'anonymous', SEPT).remaining, 1);
});

test('un achat du mois dernier ne recharge pas le mois courant', () => {
  // Le compteur du mois écoulé est simplement ignoré : la période fait foi.
  const vieilAchat = { used: 3, period: '2026-08', last_order_period: '2026-08' };
  assert.equal(Q.evaluate(vieilAchat, 'customer', SEPT).allowed, true,
    'nouveau mois → nouveau quota, indépendamment de l\'achat passé');
  const epuiseCeMois = { used: 3, period: '2026-09', last_order_period: '2026-08' };
  assert.equal(Q.evaluate(epuiseCeMois, 'customer', SEPT).allowed, false);
});

test('la période est mensuelle et indépendante du fuseau serveur', () => {
  assert.equal(Q.periodKey(new Date('2026-09-30T23:59:59Z')), '2026-09');
  assert.equal(Q.periodKey(new Date('2026-10-01T00:00:00Z')), '2026-10');
  assert.equal(Q.periodKey(new Date('2026-01-05T12:00:00Z')), '2026-01');
  assert.match(Q.periodKey('date invalide'), /^\d{4}-\d{2}$/); // repli sur maintenant
});

test('les identités sont normalisées, les valeurs douteuses rejetées', () => {
  assert.equal(Q.identityKey('customer', 'gid://shopify/Customer/7712345'), 'customer:7712345');
  assert.equal(Q.identityKey('customer', '7712345'), 'customer:7712345');
  assert.equal(Q.identityKey('email', 'Alan@Winshirt.FR'), 'email:alan@winshirt.fr');
  assert.equal(Q.identityKey('visitor', 'a1b2c3d4-e5f6'), 'visitor:a1b2c3d4-e5f6');

  for (const bad of [['customer', 'abc'], ['email', 'pas-un-mail'], ['visitor', 'court'],
                     ['visitor', 'contient des espaces'], ['inconnu', 'x'], ['customer', '']]) {
    assert.equal(Q.identityKey(bad[0], bad[1]), null, JSON.stringify(bad));
  }
});

test('un type d\'identité inconnu est traité comme anonyme', () => {
  assert.equal(Q.limitFor('customer'), 3);
  assert.equal(Q.limitFor('anonymous'), 1);
  assert.equal(Q.limitFor('n\'importe quoi'), 1);
  assert.equal(Q.limitFor(undefined), 1);
});
