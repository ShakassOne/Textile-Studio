# TextileLab Studio — Backend

API REST Node.js 22 + Express + SQLite pour l'application Shopify de personnalisation textile.

## Démarrage rapide

```bash
npm install
cp .env.example .env   # puis éditer avec vos clés
npm run dev            # dev (rechargement auto)
npm start              # prod
```

## Docker (recommandé en prod)

```bash
docker compose up -d          # démarrer
docker compose logs -f        # logs
docker compose down           # arrêter
docker compose up -d --build  # mettre à jour après git pull
```

Les données (SQLite + uploads) persistent dans `./db/` et `./uploads/`.

## Structure

```
textilelab-backend/
├── server.js / .env.example / Dockerfile / docker-compose.yml
├── db/database.js          SQLite init (5 tables)
├── routes/
│   ├── auth.js             Login, logout, change-password, sessions
│   ├── designs.js          CRUD designs
│   ├── orders.js           CRUD commandes + pricing auto
│   ├── render.js           Rendu HD 300 DPI async
│   ├── library.js          Bibliothèque images
│   ├── mockups.js          Mockups produits
│   ├── pricing.js          Grille tarifaire
│   ├── email.js            Emails HTML (confirmation, expédition, test)
│   ├── storefront.js       Shopify Storefront API
│   ├── ai.js               DALL-E 3
│   └── shopify.js          Webhook orders/paid (HMAC)
├── utils/cloudStorage.js   Cloudinary / AWS S3
└── public/                 Pages HTML (studio, admin, backoffice, login)
```

## Routes API

### Auth  `/api/auth/`
| POST /login | POST /logout | GET /me | POST /change-password | GET /sessions |

### Designs  `/api/designs`
| GET (liste) | POST (créer) | GET /:id | PUT /:id | DELETE /:id |

### Commandes  `/api/orders`
| GET (liste) | POST (créer) | GET /:id | PATCH /:id (statut) |

### Tarification
| GET /api/pricing | PUT /api/pricing ✓ |

### Rendu HD
| POST /api/render ✓ | GET /api/render/:jobId ✓ |

Résolutions 300 DPI : A3 3508×4961 · A4 2480×3508 · A5 1748×2480 · A6 1240×1748

### Bibliothèque
| GET /api/library | POST /api/library ✓ | POST /api/library/upload ✓ | DELETE /api/library/:id ✓ |

### Mockups
| GET /api/mockups | POST ✓ | PUT /:id ✓ | DELETE /:id ✓ | GET /product/:key |

### Emails
| POST /api/email/order-confirmation | POST /api/email/shipping-update ✓ | POST /api/email/test ✓ |

### Shopify
| GET /api/shopify/status | POST /api/shopify/checkout | POST /shopify/webhook (HMAC) |

### IA
| GET /api/ai/status | POST /api/ai/generate |

> ✓ = authentification requise (header `Authorization: Bearer <token>`)

## Variables d'environnement clés

```env
PORT=3001
ADMIN_USER=admin
ADMIN_PASSWORD=changeme          # ⚠ Changer avant la mise en prod !
TOKEN_SECRET=random_hex_64chars  # openssl rand -hex 32

RESEND_API_KEY=re_xxx            # ou SENDGRID_API_KEY
FROM_EMAIL=noreply@domaine.com

SHOPIFY_STORE_DOMAIN=store.myshopify.com
SHOPIFY_STOREFRONT_TOKEN=xxx
SHOPIFY_WEBHOOK_SECRET=xxx

OPENAI_API_KEY=sk-xxx            # pour DALL-E 3
CLOUDINARY_URL=cloudinary://...  # ou AWS S3 (voir .env.example)
```

## Webhook Shopify

1. Shopify Admin → Settings → Notifications → Webhooks
2. Événement : `orders/paid` → `https://votre-domaine.com/shopify/webhook`
3. Coller le secret dans `.env` → `SHOPIFY_WEBHOOK_SECRET`
