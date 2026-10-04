'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { COMMON_RENDER_RULES, buildGenerationPrompt, buildTransformPrompt } = require('../utils/ai-prompts');

test('buildGenerationPrompt enrobe la demande du client avec les règles de rendu communes', () => {
  const prompt = buildGenerationPrompt('un dragon rouge en style néon');
  assert.ok(prompt.startsWith('un dragon rouge en style néon'));
  assert.ok(prompt.includes('Strict requirements:'));
  for (const rule of COMMON_RENDER_RULES) {
    assert.ok(prompt.includes(rule), `règle manquante : ${rule}`);
  }
});

test('buildGenerationPrompt accepte un prompt vide sans planter', () => {
  const prompt = buildGenerationPrompt('');
  assert.ok(prompt.includes('Strict requirements:'));
});

test('buildTransformPrompt (défaut, sans flag) garde la formulation historique centrée visage/personnes', () => {
  const prompt = buildTransformPrompt('style cartoon', false, '');
  assert.ok(prompt.includes('Keep the EXACT number of people present in the source photo.'));
  assert.ok(prompt.includes("Preserve each person's likeness: face, glasses, beard, hairstyle and hair length, and smile/expression."));
  assert.ok(!prompt.includes('distinct subjects'));
});

test('buildTransformPrompt avec genericIdentityPrompt=true bascule sur une formulation neutre', () => {
  const prompt = buildTransformPrompt('style cartoon', false, '', true);
  assert.ok(prompt.includes('Keep the exact number of distinct subjects present in the source photo.'));
  assert.ok(prompt.includes("Preserve each subject's key identifying features and overall appearance"));
  assert.ok(!prompt.includes("face, glasses, beard, hairstyle"));
});

test('buildTransformPrompt avec genericIdentityPrompt=false (explicite) reste identique au comportement par défaut', () => {
  const withFalse = buildTransformPrompt('style cartoon', false, '', false);
  const withoutArg = buildTransformPrompt('style cartoon', false, '');
  assert.equal(withFalse, withoutArg);
});

test('buildTransformPrompt structure Image A/Image B quand une référence de style est utilisée, flag générique inclus', () => {
  const prompt = buildTransformPrompt('style cartoon', true, '', true);
  assert.ok(prompt.includes('IMAGE A (the FIRST image) = SOURCE IDENTITY.'));
  assert.ok(prompt.includes('IMAGE B (the SECOND image) = STYLE REFERENCE.'));
  assert.ok(prompt.includes("Preserve each subject's key identifying features"));
});

test('buildTransformPrompt priorise la consigne libre du client sur le prompt du style', () => {
  const prompt = buildTransformPrompt('style cartoon', false, 'transforme en affiche vintage');
  assert.ok(prompt.startsWith('transforme en affiche vintage'));
  assert.ok(!prompt.startsWith('style cartoon'));
});

test('buildTransformPrompt retombe sur le fallback cartoon si ni prompt custom ni consigne libre', () => {
  const prompt = buildTransformPrompt('', false, '');
  assert.ok(prompt.startsWith('Transform this photo into a vibrant cartoon illustration'));
});

test('les deux formulations d\'identité incluent toujours les mêmes règles de rendu communes', () => {
  const generic = buildTransformPrompt('style cartoon', false, '', true);
  const historic = buildTransformPrompt('style cartoon', false, '', false);
  for (const rule of COMMON_RENDER_RULES) {
    assert.ok(generic.includes(rule));
    assert.ok(historic.includes(rule));
  }
});
