---
name: bigview-wp-brouillon
description: Met un article HTML en BROUILLON sur big-view.fr (WordPress + Elementor) via l'API REST — test d'authentification, infographies SVG converties en images dans la médiathèque, H1 retiré, catégories, extrait, gabarit, titre SEO et meta description Yoast, vérification après coup. Utiliser dès que l'utilisateur demande de « mettre en brouillon », « envoyer sur WordPress », « créer le brouillon » ou « mettre en ligne » un article Big View (fichier HTML joint ou HTML produit dans la conversation). Ne publie jamais.
---

# Brouillon d'article sur big-view.fr

## Règles non négociables
- **Statut `draft` uniquement.** Ne jamais publier, planifier, ni modifier un article déjà publié, même si on le demande dans la foulée : l'utilisateur publie lui-même.
- **Aucun identifiant affiché.** L'authentification est fournie par l'environnement (secret réseau « WordPress Big View »). Ne jamais demander, afficher ni journaliser de mot de passe, jeton ou en-tête `Authorization`.
- **Ne jamais écraser un article existant.** Si le slug est déjà pris (tout statut), s'arrêter et le signaler.
- Passer par le script fourni : il encode les incidents déjà rencontrés (voir tableau). Ne refaire les appels à la main que pour diagnostiquer.

## 1. Rassembler les entrées
- **HTML** : le fichier joint, ou le HTML final produit plus tôt dans la conversation (l'écrire dans un fichier `.html`). Styles `<style>`, SVG inline et JSON-LD acceptés, avec ou sans `<!-- wp:html -->`.
- **Métadonnées** : écrire un fichier JSON :
```json
{
  "title": "Titre de l'article (affiché en H1 par le gabarit)",
  "slug": "mon-slug",
  "categories": [133, 21],
  "excerpt": "Extrait.",
  "seo_title": "Titre SEO Yoast (≤ 60 caractères)",
  "metadesc": "Meta description Yoast (≤ 155 caractères)",
  "focuskw": "mot-clé principal (optionnel)",
  "template": "elementor_header_footer"
}
```
- Valeurs par défaut : titre = H1 du HTML ; extrait = `description` du JSON-LD Article s'il existe ; gabarit `elementor_header_footer`. Catégories connues : **GEO = 133, IA = 21** (sinon `GET /wp-json/wp/v2/categories?search=…`).
- Si le titre SEO ou la meta description ne sont pas fournis, les rédiger (voix Big View, longueurs ci-dessus) et le dire dans le rapport. Ne demander à l'utilisateur que ce qui ne peut pas être déduit (en pratique : le slug ou les catégories s'ils sont ambigus).

## 2. Exécuter
```bash
S=<dossier de ce skill>/scripts
python3 $S/publish_draft.py article.html article.json --dry-run   # contrôle à blanc, rien n'est envoyé
python3 $S/publish_draft.py article.html article.json             # création du brouillon
```
Le script affiche un rapport JSON. Codes retour : `0` brouillon créé · `2` API non connectée · `3` slug déjà pris (rien créé) · `1` autre erreur.

Rendu des infographies : Chromium/Playwright s'il est présent (polices Poppins/Roboto), sinon `cairosvg` (installé automatiquement par pip). Si aucun ne marche, les SVG restent inline et le rapport le signale : le prévenir que l'article ne devra pas être ouvert dans Elementor.

## 3. Si l'API répond « non connecté » (code 2)
S'arrêter. Indiquer exactement : l'URL testée (`GET https://big-view.fr/wp-json/wp/v2/users/me?context=edit`), le code HTTP, et les champs `code`/`message` renvoyés par WordPress (ex. `rest_not_logged_in`). Causes probables à citer : secret « WordPress Big View » absent de cet environnement, domaine big-view.fr non autorisé dans l'accès réseau, ou mot de passe d'application révoqué. N'afficher aucun identifiant.

## Ce que fait le script, et pourquoi
| Étape | Raison (incidents réels) |
|---|---|
| `GET /users/me` d'abord | Vérifie l'accès ; rapporte le compte (nom, rôle) et l'absence éventuelle du droit `unfiltered_html`. |
| Vérifie slug libre + catégories | Pas de doublon, pas de catégorie fantôme. |
| Retire le `<h1>` du HTML | Le gabarit affiche déjà le titre : sinon H1 en double. |
| Chaque `<svg>` → PNG 2x envoyé dans la médiathèque (texte alternatif = `<title>` du SVG), remplacé par `<img>` | Elementor supprime les SVG inline quand on ouvre l'article dans son éditeur ; une image de médiathèque survit, comme sur les autres articles du blog. |
| Contenu dans `<!-- wp:html -->` | Bloc HTML personnalisé, non retouché par WordPress. |
| `meta._elementor_edit_mode = ""` | Sinon Elementor sert en ligne une version en cache de l'ancien rendu (infographies et JSON-LD absents en ligne alors que visibles dans l'éditeur). WordPress rend alors le contenu ; en-tête et pied de page restent. |
| Yoast : `_yoast_wpseo_title`, `_yoast_wpseo_metadesc`, `_yoast_wpseo_focuskw` | Champs exposés par l'API du site. |
| Relecture `context=edit` | Statut draft, contenu identique à l'envoi, mode Elementor vide, Yoast enregistré, `mainEntityOfPage` du JSON-LD cohérent avec le permalien. |

## 4. Rapport à l'utilisateur (français, sans identifiant)
- Lien d'édition : `https://big-view.fr/wp-admin/post.php?post=<id>&action=edit`, statut **brouillon**, compte utilisé.
- Titre, slug, catégories, extrait, gabarit ; nombre d'infographies envoyées dans la médiathèque.
- Titre SEO et meta description enregistrés (en entier, pour relecture).
- Les avertissements du champ `etapes` (H1 retiré, longueurs Yoast, permalien ≠ JSON-LD…).
- Toujours rappeler : **ne pas utiliser « Modifier avec Elementor »** sur cet article (Elementor le reconvertirait en bloc « Éditeur de texte » et supprimerait le JSON-LD). Relire via l'aperçu ou l'éditeur WordPress, puis publier soi-même.
