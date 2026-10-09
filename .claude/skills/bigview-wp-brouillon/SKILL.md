---
name: bigview-wp-brouillon
description: Met en ligne en BROUILLON sur big-view.fr (WordPress + Elementor) les articles HTML en attente dans articles/inbox/ — test d'authentification, infographies SVG converties en images dans la médiathèque, H1 retiré, catégories, extrait, gabarit, champs Yoast, vérification après coup. Utiliser pour toute tâche planifiée ou demande du type « mets cet article en brouillon sur big-view.fr ». Ne publie jamais.
---

# Brouillons d'articles sur big-view.fr

## Règles non négociables
- **Statut `draft` uniquement.** Ne jamais publier, planifier ni modifier un article déjà publié.
- **Aucun identifiant affiché.** L'authentification est injectée par le proxy réseau (secret « WordPress Big View »). Ne jamais chercher, afficher ni journaliser d'en-tête `Authorization`, de mot de passe ou de jeton.
- **Ne jamais écraser un article existant.** Si le slug est déjà pris (quel que soit le statut), passer l'article et le signaler.
- Utiliser le script fourni : il encode les leçons ci-dessous. Ne pas refaire les appels à la main sauf diagnostic.

## Entrées : `articles/inbox/`
Chaque article = deux fichiers de même nom :
- `<slug>.html` : le HTML de l'article (avec ou sans `<!-- wp:html -->`), styles `<style>`, SVG inline et JSON-LD autorisés.
- `<slug>.json` :
```json
{
  "title": "Titre de l'article (H1 affiché par le gabarit)",
  "slug": "mon-slug",
  "categories": [133, 21],
  "excerpt": "Extrait.",
  "seo_title": "Titre SEO Yoast (≤ 60 caractères)",
  "metadesc": "Meta description Yoast (≤ 155 caractères)",
  "focuskw": "mot-clé principal (optionnel)",
  "template": "elementor_header_footer"
}
```
Catégories utiles : GEO = 133, IA = 21 (vérifier les autres avec `GET /wp-json/wp/v2/categories?search=…`).
Si `seo_title` ou `metadesc` manque, les rédiger (voix Big View, ≤ 60 / ≤ 155 caractères) et l'indiquer dans le rapport.

## Déroulé
1. Lister `articles/inbox/*.html` ayant un `.json` jumeau. Aucun → rapport « rien à traiter », fin.
2. Pour chaque article, d'abord à blanc puis pour de vrai :
   ```bash
   S=.claude/skills/bigview-wp-brouillon/scripts
   python3 $S/publish_draft.py articles/inbox/<slug>.html articles/inbox/<slug>.json --dry-run
   python3 $S/publish_draft.py articles/inbox/<slug>.html articles/inbox/<slug>.json
   ```
   Codes retour : `0` brouillon créé · `2` API non connectée (arrêter tout) · `3` slug déjà pris (passer au suivant) · `1` autre erreur (passer au suivant, rapporter).
3. Si le rendu PNG échoue (Chromium/Playwright), Chromium est dans `/opt/pw-browsers` ; relancer avec `CHROMIUM_PATH=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux/chrome | head -1)`. Ne jamais lancer `playwright install`.
4. Rapport final (voir plus bas).

## Ce que fait le script (et pourquoi)
| Étape | Raison (incidents réels) |
|---|---|
| `GET /users/me?context=edit` d'abord | Vérifie que le secret réseau fonctionne ; sinon code 2 avec le statut HTTP, sans identifiant. |
| Vérifie slug libre + catégories | Évite doublons et catégories fantômes. |
| Retire le `<h1>` du HTML | Le gabarit affiche déjà le titre : sinon H1 en double. |
| Convertit chaque `<svg>` en PNG 2x (polices Poppins/Roboto), l'envoie dans la médiathèque avec un texte alternatif (= `<title>` du SVG) et le remplace par `<img>` | Elementor supprime les SVG inline dès qu'on ouvre l'article dans son éditeur ; une image de médiathèque survit, comme sur les autres articles du blog. |
| Contenu enveloppé dans `<!-- wp:html -->` | Bloc HTML personnalisé, non retouché par WordPress. |
| `meta._elementor_edit_mode = ""` | Sinon Elementor sert une version en cache de l'ancien rendu (infographies et JSON-LD absents en ligne alors qu'ils sont visibles dans l'éditeur). WordPress rend alors le contenu lui-même ; en-tête et pied de page du site restent. |
| Yoast via `meta._yoast_wpseo_title`, `_yoast_wpseo_metadesc`, `_yoast_wpseo_focuskw` | Champs exposés par l'API du site. |
| Relit le brouillon (`context=edit`) | Contrôle : statut draft, contenu identique, mode Elementor vide, Yoast enregistré, cohérence du permalien avec le `mainEntityOfPage` du JSON-LD. |

## Rapport final (en français, sans identifiant)
Pour chaque article : titre, lien d'édition `https://big-view.fr/wp-admin/post.php?post=<id>&action=edit`, statut (brouillon), catégories, nombre d'infographies envoyées, titre SEO et meta description enregistrés, avertissements (`etapes` du rapport JSON). Puis les articles passés (slug pris, erreur) avec la raison.
Rappeler à chaque fois : **ne pas ouvrir l'article avec « Modifier avec Elementor »** (Elementor le reconvertirait en bloc « Éditeur de texte » et supprimerait le JSON-LD) ; le relire dans l'éditeur WordPress ou l'aperçu, puis publier soi-même.

Si l'API répond « non connecté » (401/403 sur `/users/me`) : arrêter, indiquer exactement l'URL testée, le code HTTP et le message `code`/`message` renvoyé par WordPress, et vérifier le secret « WordPress Big View » de l'environnement. Ne rien afficher d'autre.

## Après traitement
Ne pas supprimer les fichiers de `articles/inbox/` : le contrôle du slug rend la tâche idempotente (un article déjà créé est simplement passé au prochain passage).
