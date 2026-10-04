'use strict';
/**
 * utils/ai-prompts.js — Construction des prompts IA (Photo → Illustration).
 * ──────────────────────────────────────────────────────────────────────────
 * Extrait de routes/ai.js en module pur (aucune dépendance DB/auth) pour être
 * testable directement par `node --test` sans charger routes/auth.js, qui pose
 * un setInterval de nettoyage de sessions au require et empêche le process de
 * se terminer (même piège que documenté dans tests/upsell-candidates.test.js).
 */

// Fallback minimal si le style "cartoon" n'a ni prompt DB ni prompt custom
// (défense en profondeur, STYLE_PROMPTS_FALLBACK.cartoon dans routes/ai.js
// couvre déjà ce cas en amont — ce texte ne devrait jamais être atteint).
const CARTOON_FALLBACK = 'Transform this photo into a vibrant cartoon illustration, bold outlines, flat bright colors, expressive, transparent background, DTF print ready, no background';

// Règles de rendu communes à TOUTES les générations, quelle que soit la route.
// Le cadrage est le premier point : sans consigne explicite, gpt-image-1 cadre
// serré et rogne systématiquement le sujet (tête, pieds, bords du dessin).
const COMMON_RENDER_RULES = [
  'CRITICAL — FRAMING: the ENTIRE subject must be fully visible inside the image, nothing cropped.',
  'Do NOT crop or cut off any part of the artwork: no cropped head, hair, ears, feet, hands, wings, tails, weapons or lettering.',
  'Leave a comfortable empty margin on ALL FOUR sides (roughly 10% of the image): headroom above, footroom below, and space left and right.',
  'Compose the subject fully zoomed out and centered. Never bleed off the edges, never let any element touch the border.',
  'Clean illustration: avoid any greasy, oily, waxy or pasty over-rendered look — keep crisp, clean edges.',
  'Fully transparent background (PNG alpha): no background scene, no backdrop, no canvas, no drop shadow.',
  'Deliver a print-ready DTF transfer: high contrast, clean separated colors, no semi-transparent halo around the edges.',
];

// Prompt des générations de zéro (POST /dalle). On enrobe la demande du client
// des mêmes règles que la transformation de photo — notamment le cadrage, qui
// manquait ici : les visuels revenaient rognés sur les bords.
function buildGenerationPrompt(userPrompt) {
  const base = String(userPrompt || '').trim();
  return [
    base,
    '',
    'Strict requirements:',
    ...COMMON_RENDER_RULES.map((r) => '- ' + r),
  ].join('\n');
}

// Consignes d'identité du sujet, avant les règles de rendu communes.
// - Variante historique (people) : suppose un ou plusieurs humains avec
//   visage/barbe/coiffure — dégrade le résultat sur une photo sans visage
//   (animal, objet, logo, paysage), cf. ROADMAP-DEV.md backlog item 16.
// - Variante générique (subject) : formulation neutre, valable quel que soit
//   le contenu de la photo. Choix fait via le flag `ai_generic_identity_prompt_enabled`
//   (routes/shop-settings.js), désactivé par défaut tant qu'elle n'a pas été
//   comparée sur un échantillon réel de photos (portraits ET non-portraits).
function identityLines(genericIdentityPrompt) {
  if (genericIdentityPrompt) {
    return [
      'Keep the exact number of distinct subjects present in the source photo.',
      "Preserve each subject's key identifying features and overall appearance (face, markings, shape, proportions, expression if applicable).",
    ];
  }
  return [
    'Keep the EXACT number of people present in the source photo.',
    "Preserve each person's likeness: face, glasses, beard, hairstyle and hair length, and smile/expression.",
  ];
}

// hasStyleReference=true → prompt structuré Image A (identité) / Image B (style),
// sinon fallback texte seul (point 5). Le prompt custom du style est conservé
// puis enrichi (point 9) avec les contraintes d'identité et de rendu.
function buildTransformPrompt(customPrompt, hasStyleReference, userPrompt, genericIdentityPrompt) {
  // La consigne libre du client prime sur le prompt du style : c'est elle qui
  // exprime son intention (« transforme cette photo en affiche vintage »).
  // Sans consigne, on retombe sur le prompt du style, comportement historique.
  const free = String(userPrompt || '').trim();
  const base = free || (customPrompt || CARTOON_FALLBACK).trim();
  const commonRules = [
    ...identityLines(genericIdentityPrompt),
    ...COMMON_RENDER_RULES,
  ];
  if (hasStyleReference) {
    return [
      'You are given TWO reference images.',
      'IMAGE A (the FIRST image) = SOURCE IDENTITY. The people, their count and their likeness must come EXCLUSIVELY from IMAGE A.',
      'IMAGE B (the SECOND image) = STYLE REFERENCE. Use IMAGE B ONLY as a strict graphic-style reference (line work, shading, color treatment, finish). Do NOT copy the people, faces, objects, composition or background of IMAGE B.',
      '',
      'Redraw the subject of IMAGE A in this style: ' + base,
      '',
      'Strict requirements:',
      '- Use IMAGE B as a STRICT style reference only; identity and number of people come solely from IMAGE A.',
      ...commonRules.map((r) => '- ' + r),
    ].join('\n');
  }
  return [
    base,
    '',
    'Strict requirements:',
    ...commonRules.map((r) => '- ' + r),
  ].join('\n');
}

module.exports = { COMMON_RENDER_RULES, buildGenerationPrompt, buildTransformPrompt };
