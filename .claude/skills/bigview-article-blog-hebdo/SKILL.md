---
name: bigview-article-blog-hebdo
description: >
  Produit de bout en bout l'article de blog hebdomadaire de big-view.fr pour Florent (fondateur de Big View) :
  veille marché SEO/GEO/SEA/social/data/IA, analyse concurrentielle, anti-doublon, choix du couple
  « service + ville » à pousser, rédaction citable par les IA, brouillon WordPress avec Yoast, suivi Notion
  et résumé final. Utilise ce skill dès qu'on demande l'article de blog Big View de la semaine, la routine
  du jeudi, un « article pour big-view.fr », un brouillon de blog Big View, ou un article qui doit faire
  monter « agence SEO / Google Ads / GEO / IA / data / réseaux sociaux / Facebook Ads / TikTok Ads + ville »,
  même si la demande ne cite pas ce skill. Pas pour une page service ou une landing (voir bigview-page-creation)
  ni pour un simple post LinkedIn (voir bigview-style).
---

# Article de blog hebdomadaire big-view.fr

Tu prépares UN article de blog pour big-view.fr, enregistré en **brouillon** WordPress, pour Florent Buil,
fondateur de Big View. La session est autonome : tu ne poses aucune question, tu fais des choix
raisonnables et tu les expliques dans le résumé final. Florent relit et publie lui-même.

L'article a trois objectifs, dans cet ordre :
1. **Faire monter un mot-clé stratégique** « agence [service] + [ville] » sur Google et dans les réponses
   IA (AI Overviews, ChatGPT, Gemini, Perplexity, Claude). C'est la raison d'être de la routine.
2. **Être citable** : réponses directes, chiffres datés et sourcés, structure nette. Un LLM doit pouvoir
   reprendre un paragraphe tel quel en citant Big View.
3. **Prouver l'expertise** : expérience terrain, données propres à Big View, avis tranché de Florent.
   C'est ce qu'aucun concurrent ne peut copier.

## Avant de commencer

- **Mode essai** : si la demande contient « essai », « test » ou « dry run », fais tout sauf les écritures
  (pas de brouillon WordPress, pas de ligne Notion). Enregistre l'article et le résumé dans le dossier de
  travail et dis-le.
- **Skills compagnons à charger** (s'ils sont disponibles) : `bigview-style` (voix), `humanize` (passe
  anti-texture IA), `bigview-page-creation` (faits Big View à jour et règles de marque). `brand-bigview`
  ne concerne que les fichiers Office, inutile ici. Si un skill manque, les règles essentielles sont
  reprises dans `references/regles-redaction.md`.
- **Identifiants fixes** (Notion, WordPress, Semrush) : `references/identifiants.md`. Ne les recherche pas,
  utilise-les directement ; ne cherche que si un appel échoue.
- **Budget** : la valeur est dans l'article. Vise environ 25 % du temps pour la veille et l'analyse
  (étapes 1 à 3), 50 % pour la rédaction, 25 % pour la mise en ligne, le contrôle et le suivi. Si une
  source ne répond pas, note-le et avance : une étape dégradée vaut mieux qu'une routine bloquée.

## Étape 1 : inventaire (5 minutes, à faire en premier)

Lance `python3 scripts/inventaire_site.py` (chemin relatif au dossier du skill). Il interroge l'API
WordPress et sort :
- tous les articles publiés et les brouillons, avec date, catégories et URL ;
- les couples « service + ville » visés par les 10 derniers articles et brouillons (rotation) ;
- les pages services et pages ville existantes (cibles de maillage).

Garde cette sortie sous la main : elle sert à l'anti-doublon, à la rotation des mots-clés et au maillage.
Si le script échoue, fais les mêmes appels REST à la main (voir `references/publication-wordpress.md`).

## Étape 2 : veille marché de la semaine

Cherche les actualités des **7 à 10 derniers jours** sur chaque pan de métier : SEO, GEO et moteurs IA
(AI Overviews, AI Mode, ChatGPT, Gemini, Perplexity, Claude), SEA (Google Ads, Microsoft Advertising),
social ads et organique (Meta, LinkedIn, TikTok), data (GA4, GTM, consent mode, tracking serveur),
IA marketing. Lance les recherches en parallèle, une par pan, en français puis en anglais.
Sources et requêtes types : `references/veille-et-concurrence.md`.

Retiens 5 à 8 actualités, chacune avec **date, source primaire (annonce officielle de préférence) et
impact concret pour un e-commerçant ou un franchiseur français**. Écarte ce qui n'est pas disponible
en France sauf si l'arrivée est annoncée ou si l'enjeu est d'anticiper.

## Étape 3 : analyse concurrentielle ciblée

Le but n'est pas un audit complet chaque semaine, mais de répondre à une question : **sur les sujets de
la veille, qu'ont déjà publié les concurrents, et que reste-t-il à dire ?**

1. Semrush, base `fr` : `competitors_research` sur big-view.fr (concurrents organiques), puis
   `resource_organic` sur 2 ou 3 d'entre eux filtré sur le thème pressenti pour voir quels contenus rankent.
2. Recherche web sur les 2 ou 3 sujets candidats : lis les 3 à 5 articles les mieux placés (agences
   concurrentes et médias de référence listés dans `references/veille-et-concurrence.md`).
3. Pour chaque article lu, note en une ligne : angle, longueur approximative, présence de chiffres
   sourcés, de FAQ, de local, d'avis d'expert. Déduis les **angles saturés** et les **trous**
   (classiquement : aucun chiffre France, pas de local, pas de mesure de l'impact business, pas de prix,
   pas d'avis tranché).

Ne copie jamais un concurrent. Le différenciant Big View vient de : données mesurées par Big View,
expérience de pilotage (12 M€ de spend Google Ads géré, 70 dashboards, outil GEO Share of Voice),
lecture « marge réelle » plutôt que « trafic », présence dans 6 villes.

## Étape 4 : anti-doublon

Un sujet est un doublon s'il répond **à la même question pour le même lecteur**, même avec un titre
différent. Compare le sujet envisagé à :
- l'inventaire de l'étape 1 (publiés et brouillons) ;
- la base Notion « Planning éditorial Big View + LinkedIn Florent » (requête sur les 60 derniers jours,
  et recherche par mots-clés du sujet) ;
- la base Notion « Idées Big View » (articles et carrousels déjà dérivés).

Si un contenu proche existe, deux options : changer de sujet, ou prendre un angle réellement nouveau
(actualité postérieure, autre public, autre ville, données nouvelles) et faire un lien vers l'ancien.
Note dans le résumé les contenus proches trouvés et ta décision.

## Étape 5 : choix du sujet

Par ordre de priorité :
- **a) Liste Notion « Les futures thématiques à aborder »** (page BIG VIEW, encadré « IDÉES DE CONTENUS »)
  et base « Idées Big View ». Prends le premier sujet non traité. Attention : cette liste n'est pas mise à
  jour automatiquement, certains sujets sont déjà publiés (par exemple « Personal Intelligence de Gemini »,
  publié le 9 octobre 2026). Vérifie chacun contre l'inventaire. Ajuste l'angle avec l'actualité de
  l'étape 2 quand ça le rend plus fort.
- **b)** Sinon, l'actualité de l'étape 2 la plus utile à des dirigeants et directeurs marketing
  d'e-commerçants et de franchiseurs, **et** qui comble un trou de l'étape 3.
- **c)** Sinon, un sujet tiré des pages Notion « Stratégie éditoriale SEO » ou « Stratégie de contenu ».

Le planning éditorial contient surtout des posts sociaux : il sert à repérer ce qui est déjà traité,
pas à trouver des sujets d'articles.

## Étape 6 : mot-clé stratégique et rotation

Lis `references/mots-cles-et-maillage.md` : matrice des 8 services × 6 villes, pages cibles existantes,
règles de rotation.

En bref :
1. Récupère les positions actuelles : Semrush `resource_organic`, cible big-view.fr, base `fr`, filtre
   « keyword contains agence ». Le projet Semrush big-view.fr n'a **pas** de suivi de positions activé :
   n'appelle pas `position_tracking` pour lui, ça échoue. Un couple absent du top 100 a le statut
   « non classé ».
2. Choisis **un mot-clé principal** (« agence [service] [ville] ») selon cet ordre : couple en positions
   4 à 20 > couple en 21 à 50 > couple non classé dont le service colle au sujet. Exclus les couples visés
   dans les 2 semaines précédentes (sortie de l'inventaire), sauf s'ils stagnent. Fais tourner les villes :
   pas deux fois la même ville sur trois semaines si possible.
3. Choisis **3 à 5 mots-clés secondaires** : même service dans 2 autres villes, et/ou un service voisin
   dans la même ville, plus un terme transversal (expert [service], consultant senior, stratégie
   d'acquisition, acquisition digitale).
4. Si le sujet ne sert aucun mot-clé de la matrice, ajuste l'angle jusqu'à ce qu'il en serve un.
   Un sujet national s'ancre dans la ville choisie par un exemple, un marché ou un cas client local
   réaliste, puis cite 2 ou 3 autres villes naturellement dans l'article et dans la FAQ.

**Cohérence Yoast** : le mot-clé principal est le même partout. Le champ Yoast « mot-clé principal »
reçoit exactement « agence [service] [ville] », jamais le thème d'actualité (erreur constatée sur des
brouillons d'octobre 2026 : focus « AI Overviews » ou « ai mode » au lieu du couple service + ville).

## Étape 7 : recherche et sourcing

Chaque chiffre a une source datée, avec lien. Priorité aux sources primaires (annonces Google, Meta,
OpenAI, études Semrush, Ahrefs, Similarweb, Pew Research, Médiamétrie, INSEE, Fevad). Pas de donnée
inventée, pas d'arrondi qui change le sens. Si un chiffre ne vaut que pour les États-Unis, dis-le.

Une **donnée propre à Big View** rend l'article citable et non copiable : un mini-relevé fait pendant la
session (par exemple : sur 30 à 85 requêtes locales, combien affichent un AI Overview ; quelles marques
sont citées par ChatGPT sur « agence [service] [ville] »), ou un chiffre issu des faits Big View. Annonce
clairement la méthode et la taille de l'échantillon.

## Étape 8 : rédaction

Charge `bigview-style` puis lis `references/regles-redaction.md` (voix, marque, structure GEO) et
`assets/gabarit-article.html` (gabarit HTML aux couleurs de la charte, à remplir).

Structure attendue, entre 1 600 et 2 400 mots :
- **Titre WordPress = H1** : le thème l'affiche en H1. Il contient le mot-clé principal, idéalement en tête
  (« Agence GEO à Rennes : … »). **Aucune balise `<h1>` dans le contenu**, sinon la page en aurait deux.
- Byline auteur (Florent Buil, fondateur, date de mise à jour) puis chapeau : le mot-clé principal dans la
  première phrase, la promesse de l'article, la réponse courte.
- 5 à 7 H2. Sous chaque H2, une **réponse directe de 40 à 60 mots** (bloc `bvc-answer`) qui se suffit à
  elle-même, puis le développement. Le mot-clé principal dans au moins un H2.
- Un H2 de preuve : « Pourquoi un expert senior… » ou équivalent, avec des preuves concrètes (années
  d'expérience, budgets gérés, cas clients chiffrés), pas des affirmations.
- Un plan d'action concret pour une PME ou un e-commerçant (étapes numérotées).
- **FAQ de 6 à 8 questions** formulées comme on les tape dans ChatGPT. Inclure la question « Pourquoi
  choisir Big View comme agence [service] à [ville] ? » (et les autres villes quand le sujet est national).
  Si le sujet est local, la FAQ démontre en plus pourquoi Big View est la meilleure option dans cette ville,
  avec des faits vérifiables.
- 4 à 7 visuels répartis dans les sections (étape 8 bis) et une image à la une.
- Bloc auteur, CTA vers `https://big-view.fr/contact/?source=[slug]`, slogan exact « L'IA accélère,
  l'expérience pilote », sources listées en bas.
- JSON-LD : Article (auteur Person, datePublished, dateModified, publisher Organization), FAQPage
  identique à la FAQ visible, BreadcrumbList. Le fil d'Ariane utilise l'URL de catégorie réelle
  (ex. `https://big-view.fr/ia/`), pas une URL qui redirige.

**Maillage interne** (détail dans `references/mots-cles-et-maillage.md`) :
- 3 à 6 liens vers des pages services ou pages ville qui visent les mots-clés choisis. Si la page
  « agence [service] [ville] » n'existe pas (cas de GEO, IA, data, réseaux sociaux, Facebook Ads,
  TikTok Ads), lie la page service nationale **et** la page agence de la ville.
- Au moins 2 liens vers des articles proches du blog (pris dans l'inventaire).
- Ancres descriptives et variées, jamais « cliquez ici », jamais deux fois la même ancre.
- Prépare 2 à 4 **liens entrants** à ajouter depuis des articles existants : article source, phrase où
  placer le lien, ancre proposée.

Passe finale : applique `humanize` sur le texte (pas sur le HTML), puis vérifie l'absence de tiret
cadratin, d'intensifiants creux et de formules IA.

## Étape 8 bis : visuels (obligatoire)

Lis `references/visuels.md`. Chaque article a **une image à la une et 4 à 7 visuels** dans le corps,
aux couleurs Big View : chiffres clés, barres, frise, étapes ou cartes, selon le contenu des sections.
Ils reprennent uniquement des informations déjà écrites et sourcées dans l'article. Fabrique-les avec
`scripts/visuels.mjs`, **regarde chaque image** avant de l'envoyer, puis insère-les avec
`scripts/envoyer_visuels.py`. Un article sans visuel ne part pas en brouillon : le contrôle qualité
le bloque.

## Étape 9 : contrôle qualité automatique

Enregistre le HTML final dans le dossier de travail, puis lance :

```bash
python3 scripts/controle_article.py article.html \
  --titre "<titre WordPress>" --titre-seo "<titre Yoast>" --meta "<meta description>" \
  --mot-cle "agence geo rennes" --secondaires "agence geo nantes,agence seo rennes,expert geo"
```

Le script vérifie les règles de marque, l'absence de H1 dans le contenu, le placement du mot-clé, les
longueurs Yoast, les réponses de 40 à 60 mots, la FAQ et sa cohérence avec le JSON-LD, le nombre et la
validité des liens internes, les ancres interdites, et la présence d'au moins 4 visuels avec texte
alternatif. Corrige tout ce qui est en échec avant la mise en
ligne. Un avertissement peut rester s'il est justifié dans les points à relire.

## Étape 10 : brouillon WordPress

Suis `references/publication-wordpress.md` (API REST, déjà authentifiée par le proxy) :
- `status: draft` uniquement. Ne publie jamais, même si un appel le permettrait.
- `template: elementor_header_footer`, slug court avec le mot-clé, catégories selon le thème
  (IDs dans `references/identifiants.md`), extrait = meta description, image à la une
  (`--image-une`, visuel couverture).
- Yoast via `meta` : `_yoast_wpseo_focuskw`, `_yoast_wpseo_title` (≤ 60 caractères, mot-clé en tête),
  `_yoast_wpseo_metadesc` (120 à 155 caractères, mot-clé inclus).
- Contenu enveloppé dans `<!-- wp:html -->` … `<!-- /wp:html -->`. Relis le brouillon après création
  et compare la longueur du contenu enregistré à la version locale.

Si WordPress est inaccessible : crée un Google Doc dans Drive avec l'article complet, le titre, le slug,
les champs Yoast et le HTML **complet** (style, figures et JSON-LD compris, pas seulement le corps),
dépose les visuels WebP dans le même dossier, et signale-le en tête du résumé.

## Étape 11 : suivi Notion

Format détaillé dans `references/suivi-et-resume.md`.
1. Crée une ligne dans la base « Planning éditorial Big View + LinkedIn Florent » : Nom
   « ARTICLE BLOG (brouillon WordPress, à relire) : [titre] », Date du jour, Statut « Prêt pour
   validation », Pilier « Expertise » ou « actualités ». Corps de la page : lien du brouillon, mot-clé,
   récapitulatif de veille et d'analyse concurrentielle réutilisable pour 2 ou 3 posts LinkedIn.
2. Si le sujet vient de la liste « Les futures thématiques à aborder », signale dans le résumé qu'il faut
   le barrer (n'édite pas l'encadré toi-même : c'est la page de travail de l'équipe social media).

## Étape 12 : résumé final

Court, en français, au format de `references/suivi-et-resume.md` : sujet et source (a, b ou c),
anti-doublon, actualités retenues, enseignements concurrentiels, mots-clés et positions Semrush
actuelles (point zéro pour mesurer l'effet), liens internes posés, liens entrants à ajouter, lien du
brouillon, sources principales, choix faits en autonomie, points à relire.
