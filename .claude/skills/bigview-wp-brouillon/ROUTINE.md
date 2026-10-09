# Routine « Brouillons blog Big View » (mardi et jeudi)

Guide complet d'un passage. Il reprend les règles de `bigview-page-creation` (marque, faits, recherche, charte, contrôles), adaptées aux **articles de blog** (type `post`), et `SKILL.md` pour la mise en brouillon. En cas de doute, ce fichier prime sur `bigview-page-creation` pour tout ce qui concerne un article.

Un passage = **au plus un article rédigé** + tous les articles déposés dans le Drive. Tout en français. **Jamais de publication.**

## Règles de marque (reprises de bigview-page-creation)
- « Big View » en deux mots, « big-view.fr ». Jamais BigView, Bigview, bigview.fr.
- Slogan unique, mot pour mot : « L'IA accélère, l'expérience pilote ».
- Voix chaleureuse, directe, ancrée dans la donnée, « on » / « nous », phrases courtes. **Aucun tiret cadratin**, pas d'intensifs creux.
- Faits Big View autorisés (rien d'autre) : experts seniors uniquement (10 à 21 ans d'expérience) ; 0 % de commission sur les budgets média ; 680 € HT/jour ; accompagnements dès 450 € HT/mois sur devis ; en moyenne ~10 % moins cher que la plupart des agences ; Google Partner et Microsoft Advertising Partner ; 6 agences (Paris, Nantes, Rennes, Montpellier, Toulouse, Marseille) ; 12 M€ de dépenses Google Ads gérées ; 127 campagnes Ads optimisées par la donnée ; 70 dashboards sur mesure et MMM ; outil GEO Share of Voice (5 canaux dont Claude, historique ; 340 € HT/mois, 250 € HT/mois pour les 20 premiers clients ; agences et multi-sites sur devis).
- Cas clients publics, en précisant qu'ils portent sur nos leviers payants : Bricovis +23,24 % de CA, ROAS 13 ; Tonton Outdoor +900 % ; Kiss My Wheels +214 % de leads qualifiés en 6 mois.
- Ne jamais inventer un chiffre, un client, un partenariat ou un résultat. Tout fait sur une plateforme (date, disponibilité en France, format, prix) est sourcé et daté, avec lien.

## Étape 0 : préparer
1. Skill : `.claude/skills/bigview-wp-brouillon` dans le dépôt geo-api-proxy. S'il manque (conteneur redémarré) : `git fetch origin claude/tender-ritchie-x3zpvz && git checkout origin/claude/tender-ritchie-x3zpvz -- .claude/skills/bigview-wp-brouillon`. Relire `SKILL.md`. Ne rien commiter.
2. Test d'accès : `GET https://big-view.fr/wp-json/wp/v2/users/me`. Échec → s'arrêter et rapporter (URL, code HTTP, `code`/`message`), sans identifiant.

## Étape 1 : articles déposés dans Google Drive (prioritaire)
Dossier « Big View – Articles à mettre en brouillon » (id `1JbMdwJYWEkhNPA403YWlkk_HxDlA5-kO`) et son sous-dossier « Générés par la routine ».
Pour chaque `.html` :
- Télécharger. S'il existe un `.json` de même nom, il fait foi ; sinon déduire : titre = H1, slug = titre simplifié (ou fin de `mainEntityOfPage`), catégories GEO 133 et/ou IA 21, titre SEO et meta description (voir étape 4).
- Appliquer les contrôles de l'étape 3 (sans réécrire l'article : signaler les écarts dans le rapport).
- Mettre en brouillon (étape 4). Code 3 = déjà traité, passer sans le mentionner.

## Étape 2 : si aucun nouveau brouillon à l'étape 1, rédiger un article
### 2a. Choisir le sujet (actualité × Semrush)
1. Lister 3 à 5 actualités GEO / recherche IA des 7 derniers jours (Google AI Overviews et AI Mode, ChatGPT, Gemini, Perplexity, Claude, Bing Copilot) utiles aux PME françaises. Sources officielles d'abord, puis presse spécialisée FR (Abondance, Journal du Net, Blog du Modérateur, Search Engine Journal…).
2. Écarter celles déjà traitées : `GET /wp-json/wp/v2/posts?search=<mot-clé>&status=publish,draft&context=edit&_fields=id,title,status`.
3. Semrush (base `fr`) : pour chaque piste, volume et difficulté du mot-clé principal et de 2-3 variantes ; position de big-view.fr si elle existe. Retenir la piste qui combine actualité forte et mot-clé à volume où big-view.fr est absent ou au-delà de la 10e place. Si Semrush est indisponible, choisir sur l'actualité seule et le dire.

### 2b. Ville du titre (rotation)
Lire les titres des 12 derniers articles (`GET /wp-json/wp/v2/posts?per_page=12&status=publish,draft&context=edit&_fields=title,date`). Prendre, parmi Montpellier, Nantes, Rennes, Paris, Toulouse, Marseille, la ville absente depuis le plus longtemps (en cas d'égalité, cet ordre). Titre : « Agence [levier] à [Ville] : [sujet] » ou une formulation naturelle équivalente. Les autres villes apparaissent dans le corps (section terrain) et dans la FAQ, sans bourrage.

### 2c. Rechercher avant d'écrire
- Faits du sujet : dates, disponibilité en France, fonctionnement, limites. Noter chaque source (titre, média, date, URL).
- Regarder 3 à 4 articles concurrents sur le même sujet : ce qu'ils disent, ce qu'ils oublient. L'angle de l'article = ce qu'un expert Big View apporte en plus (impact concret pour une PME, plan d'action, mesure).
- Maillage : choisir 3 à 5 articles ou pages big-view.fr existants et pertinents (`/agence-geo/`, `/geo-share-of-voice/`, pages villes, articles liés).

### 2d. Rédiger
- Skills dans l'ordre : `bigview-style` (voix), puis `redaction-humaine` (génération), puis `humanize` (relecture).
- Auteur : Florent Buil, fondateur (byline + encart auteur). Date « Mis à jour le » = date du passage.
- Structure (modèle : article 10392, `GET /wp-json/wp/v2/posts/10392?context=edit`, champ `content.raw`) :
  1. Bloc `<style>` scopé `.bvc` (jamais `body`, `:root` ni `*`), byline, chapeau factuel daté.
  2. Encadré « En bref » (jaune) avec lien vers la FAQ.
  3. 5 à 7 H2, chacun suivi d'une réponse directe autoportante de 40 à 60 mots (`.bvc-answer`), citable telle quelle par une IA.
  4. 2 à 4 infographies SVG (viewBox 900 de large, Poppins/Roboto, couleurs #04D99D #29D5F2 #F3D604 #131313, fonds #F0FAF6 / #F3F3F3, `<title>` et `<desc>`, source en bas). Exemple fictif = l'écrire dans l'infographie.
  5. Section terrain : la ville du titre en premier, les autres ensuite, chiffres Semrush datés s'ils sont utiles.
  6. Plan d'action concret (liste numérotée), rattaché à un objectif commercial.
  7. « Pourquoi un expert senior » avec uniquement les faits Big View autorisés.
  8. FAQ de 7 à 9 questions en `<details>`, réponses autoportantes, dont obligatoirement : la question d'actualité principale, la disponibilité en France, l'impact pour une PME, le coût d'un accompagnement Big View, et « Pourquoi choisir Big View comme agence [levier] à Paris, Nantes, Rennes, Montpellier, Toulouse ou Marseille ? ».
  9. Encart auteur, CTA audit gratuit vers `https://big-view.fr/contact/?source=<slug>`, slogan, bloc sources datées.
  10. JSON-LD : Article (headline, datePublished, dateModified, author Florent Buil, publisher Big View, `mainEntityOfPage` = permalien, `description` = meta description), FAQPage (identique à la FAQ), BreadcrumbList.
- **Pas de H1** : le gabarit des articles affiche déjà le titre.
- Permalien : WordPress préfixe l'URL avec la catégorie d'ID le plus bas (avec GEO 133 + IA 21 → `/ia/<slug>/`). Utiliser ce permalien dans le JSON-LD.
- Enregistrer `<slug>.html` et `<slug>.json` dans « Générés par la routine » (créer le sous-dossier si besoin). Si Drive est indisponible, continuer et le signaler.

## Étape 3 : contrôles avant mise en brouillon
- Texte : zéro « BigView »/« bigview.fr », zéro tiret cadratin, slogan exact, aucun H1, chaque chiffre issu des faits autorisés ou d'une source citée, chaque lien externe en `rel="nofollow noopener"`.
- Le script `publish_draft.py --dry-run` vérifie déjà la marque, le tiret cadratin, le slogan et le H1 (champ `etapes`) et prépare `content.html` avec les infographies rendues.
- Rendu : `node scripts/check_render.mjs <workdir>/content.html <workdir>` → aucun `debordement` en desktop 1440 px ni en mobile 390 px, `h1` = 0, `imagesCassees` vide. Regarder les deux captures `apercu-*.png` et corriger toute section cassée avant d'envoyer.

## Étape 4 : mise en brouillon
- Métadonnées (`<slug>.json`) : `title`, `slug`, `categories`, `seo_title` (≤ 60 caractères, mot-clé en tête), `metadesc` (≤ 155), `focuskw`, `excerpt` (par défaut = meta description), `author` (par défaut 9 = Florent Buil), `template` (par défaut `elementor_header_footer`).
- Rédiger **3 titres SEO** (angles : différenciation, local, conversion) avec leur décompte ; enregistrer le meilleur dans `seo_title`, citer les deux autres dans le rapport.
- `python3 scripts/publish_draft.py <html> <json>` (après le `--dry-run`). Le script envoie les infographies en WebP dans la médiathèque, crée le brouillon avec `_elementor_edit_mode` vide, les champs Yoast et l'auteur, puis relit le tout.
- Rien d'autre : pas de publication, pas de menu (les articles n'en ont pas), pas de modification d'un article existant.

## Étape 5 : rapport (dans la conversation)
Pour chaque brouillon :
- titre, lien d'édition wp-admin, permalien prévu, catégories, auteur ;
- origine (Drive ou rédigé), et pour un article rédigé : pourquoi ce sujet (actualité + données Semrush datées), ville du titre ;
- titre SEO enregistré + les 2 alternatives, meta description, décomptes ;
- infographies envoyées, résultats des contrôles (marque, rendu desktop/mobile), avertissements ;
- liste des sources (média, date, URL) et points à vérifier avant publication.
Puis les fichiers ignorés et pourquoi. Rappeler : relire dans l'aperçu ou l'éditeur WordPress, **ne pas utiliser « Modifier avec Elementor »**, publier soi-même. Si rien n'a été fait, une seule ligne.
