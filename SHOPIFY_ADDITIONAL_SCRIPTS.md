# Shopify Additional Scripts — Bouton "Voir mon design"

## Où coller ce script

**Boutique Shopify > Paramètres > Paiement > Page de statut de la commande**
(ou : Settings > Checkout > Additional Scripts)

Colle le code ci-dessous dans le champ "Scripts supplémentaires".

---

## Script

```liquid
{% if first_time_accessed %}
<script>
(function(){
  var BTN_STYLE = [
    'display:inline-block',
    'background:#F59E0B',
    'color:#000',
    'font-weight:700',
    'font-size:13px',
    'padding:10px 22px',
    'border-radius:8px',
    'text-decoration:none',
    'letter-spacing:.3px',
    'margin-top:6px'
  ].join(';');

  function isDesignUrl(txt){
    return txt && /https?:\/\/.+\/design-preview\/\d+/.test(txt.trim());
  }

  function inject(){
    /* ── Cas 1 : dt/dd séparés (checkout natif Shopify) ── */
    document.querySelectorAll('dt').forEach(function(dt){
      var label = dt.textContent.trim();
      if(label !== 'Voir mon design') return;
      var dd = dt.nextElementSibling;
      if(!dd) return;
      var url = dd.textContent.trim();
      if(!isDesignUrl(url)) return;
      // Ne pas remplacer deux fois
      if(dd.querySelector('a')) return;
      dd.innerHTML = '<a href="'+url+'" target="_blank" rel="noopener" style="'+BTN_STYLE+'">👕 Voir mon design</a>';
    });

    /* ── Cas 2 : span/p inline "Voir mon design: https://..." ── */
    document.querySelectorAll('span,p,td,li').forEach(function(el){
      if(el.children.length > 0) return;          // ignorer les parents
      var txt = el.textContent || '';
      if(txt.indexOf('Voir mon design') === -1) return;
      var m = txt.match(/(https?:\/\/[^\s"<>]+\/design-preview\/\d+)/);
      if(!m) return;
      if(el.querySelector('a')) return;           // déjà transformé
      var url = m[1];
      var before = txt.substring(0, txt.indexOf(url)).trim().replace(/:$/, '');
      el.innerHTML = (before ? before + ': ' : '')
        + '<a href="'+url+'" target="_blank" rel="noopener" style="'+BTN_STYLE+'">👕 Voir mon design</a>';
    });
  }

  /* Lancer dès que possible */
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', inject)
    : inject();

  /* Observer les changements dynamiques (Shopify charge en AJAX) */
  var obs = new MutationObserver(inject);
  obs.observe(document.documentElement, { childList:true, subtree:true });

  /* Sécurité : re-lancer à 1 s et 3 s */
  setTimeout(inject, 1000);
  setTimeout(inject, 3000);
})();
</script>
{% endif %}
```

---

## Résultat attendu

Sur la page "Merci pour votre commande", la propriété :

> Voir mon design : https://xxx.railway.app/design-preview/42

...devient un **bouton orange cliquable** → `👕 Voir mon design`

---

## Pour les emails Shopify (optionnel)

Dans **Boutique > Paramètres > Notifications > Confirmation de commande**, ajoute dans le template :

```liquid
{% for line in line_items %}
  {% for property in line.properties %}
    {% if property.first == 'Voir mon design' %}
      <a href="{{ property.last }}"
         style="display:inline-block;background:#F59E0B;color:#000;font-weight:700;
                padding:10px 22px;border-radius:8px;text-decoration:none;margin:8px 0">
        👕 Voir mon design
      </a>
    {% endif %}
  {% endfor %}
{% endfor %}
```
