# Shopify — Template Email Confirmation de commande

## Où modifier

**Admin Shopify → Paramètres → Notifications → Confirmation de commande → Modifier**

Dans le corps de l'email (HTML), cherche le bloc qui affiche les `line_items`
(souvent autour de `{% for line in line_items %}`).
Juste APRÈS la boucle des propriétés existantes, ajoute ce bloc :

```liquid
{% for line in line_items %}
  {% for property in line.properties %}
    {% if property.first == 'Voir mon design' and property.last != blank %}
    <div style="margin: 20px 0; text-align: center;">
      <a href="{{ property.last }}"
         target="_blank"
         style="display:inline-block;
                background-color:#F59E0B;
                color:#000000;
                font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
                font-size:14px;
                font-weight:700;
                text-decoration:none;
                padding:14px 28px;
                border-radius:8px;
                letter-spacing:0.3px;">
        &#128085; Voir votre design recto/verso
      </a>
      <p style="margin:8px 0 0;font-size:11px;color:#999999;">
        Cliquez pour voir l'aperçu de votre personnalisation
      </p>
    </div>
    {% endif %}
  {% endfor %}
{% endfor %}
```

---

## Version complète si tu veux remplacer tout le template

Si tu préfères un email entièrement custom, remplace tout le contenu par :

```liquid
{% capture email_title %}Votre commande est confirmée{% endcapture %}
{% capture email_body %}
<h2 style="font-family:sans-serif;font-size:20px;font-weight:700;color:#111;margin:0 0 8px">
  Merci pour votre commande !
</h2>
<p style="font-family:sans-serif;font-size:14px;color:#555;margin:0 0 24px">
  Nous préparons votre commande <strong>#{{ order.order_number }}</strong> avec soin.
</p>

{% for line in line_items %}
  {% for property in line.properties %}
    {% if property.first == 'Voir mon design' and property.last != blank %}
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:20px;margin:20px 0;text-align:center;">
      <p style="font-family:sans-serif;font-size:12px;color:#92400e;margin:0 0 12px;text-transform:uppercase;letter-spacing:1px;">
        Aperçu de votre design
      </p>
      <a href="{{ property.last }}"
         target="_blank"
         style="display:inline-block;background:#F59E0B;color:#000;font-family:sans-serif;
                font-size:14px;font-weight:700;text-decoration:none;
                padding:14px 32px;border-radius:8px;">
        &#128085; Voir votre design
      </a>
      <p style="font-family:sans-serif;font-size:11px;color:#aaa;margin:8px 0 0;">
        Recto &amp; verso · cliquable depuis cet email
      </p>
    </div>
    {% endif %}
  {% endfor %}
{% endfor %}
{% endcapture %}
```

---

## Additional Scripts — Page de remerciement (après paiement)

**Admin Shopify → Paramètres → Paiement → Scripts supplémentaires** (tout en bas)

```liquid
{% if first_time_accessed %}
<script>
(function(){
  var BTN='display:inline-block;background:#F59E0B;color:#000;font-weight:700;font-size:13px;padding:10px 22px;border-radius:8px;text-decoration:none;letter-spacing:.3px;margin-top:6px';
  function isUrl(t){return t&&/https?:\/\/.+\/design-preview\/\d+/.test(t.trim());}
  function go(){
    // dt/dd séparés
    document.querySelectorAll('dt').forEach(function(dt){
      if(dt.textContent.trim()!=='Voir mon design')return;
      var dd=dt.nextElementSibling;
      if(!dd||dd.querySelector('a'))return;
      var url=dd.textContent.trim();
      if(isUrl(url))dd.innerHTML='<a href="'+url+'" target="_blank" style="'+BTN+'">&#128085; Voir mon design</a>';
    });
    // texte inline
    document.querySelectorAll('span,p,td,li').forEach(function(el){
      if(el.children.length||!el.textContent.includes('Voir mon design'))return;
      var m=el.textContent.match(/(https?:\/\/[^\s"<>]+\/design-preview\/\d+)/);
      if(!m||el.querySelector('a'))return;
      var url=m[1];
      el.innerHTML=el.textContent.replace(url,'')+'<a href="'+url+'" target="_blank" style="'+BTN+'">&#128085; Voir mon design</a>';
    });
  }
  document.readyState==='loading'?document.addEventListener('DOMContentLoaded',go):go();
  new MutationObserver(go).observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(go,1000);setTimeout(go,3000);
})();
</script>
{% endif %}
```

---

## Pourquoi l'email custom TextileLab ne part pas ?

Le webhook `orders/paid` appelle bien `sendEmail()` mais Railway n'a pas encore
les variables SMTP. Ajoute dans Railway → Variables :

```
SMTP_HOST    smtp.ionos.fr
SMTP_PORT    587
SMTP_USER    alan@winshirt.fr
SMTP_PASS    MON_MOT_DE_PASSE
SMTP_FROM    TextileLab Studio <noreply@winshirt.fr>
```

Une fois ces variables ajoutées + redeploy, les emails custom partent automatiquement
avec les visuels recto/verso intégrés.
