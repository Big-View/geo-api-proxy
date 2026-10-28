# Identifiants fixes

Relevés le 28 octobre 2026. Utilise-les directement. Si un appel échoue (identifiant changé), retrouve
la ressource par recherche et signale-le dans les points à relire.

## Notion

| Ressource | Identifiant |
|---|---|
| Page « BIG VIEW » (encadré IDÉES DE CONTENUS, liste « Les futures thématiques à aborder ») | `334c4086-f13b-8010-9f4e-f3fdae3df871` |
| Base « Planning éditorial Big View + LinkedIn Florent » | base `334c4086-f13b-80da-9ff8-e45951665194`, data source `collection://334c4086-f13b-8013-a3c6-000b3265015d` |
| Base « Idées Big View » | base `2c7c4086-f13b-801c-baaa-d242510639de`, data source `collection://2c7c4086-f13b-8057-a00c-000b01011051` |
| Page « Stratégie de contenu » | `379c4086-f13b-81bc-9752-de6bed80ef0b` |
| Page « 🕵️ Veille concurrentielle Big View » (veille déjà consolidée, à lire pour ne pas refaire) | `36dc4086-f13b-81e6-94ff-e121f9373b7a` |
| Page « Stratégie éditoriale SEO » | rechercher par titre si besoin |

Propriétés de la base Planning éditorial :
- `Nom` (titre)
- `Date` (date) : utiliser `date:Date:start` au format `AAAA-MM-JJ`
- `Statut` (status) : « Pas commencé », « Visuel en cours », « Prêt pour validation », « À programmer »,
  « Programmé », « Terminé », « Stories à publier ! »
- `Pillier de contenu ` (multi-select, **avec une espace finale dans le nom**) : « Expertise »,
  « Tips/le saviez-vous », « actualités », « Vie d'agence », « Business cases », « humour »
- `Réseaux sociaux` (select) : ne pas remplir pour un article de blog
- `Validation Florent`, `Ok pour Chloé` (cases) : ne pas cocher

## WordPress big-view.fr

- API REST : `https://big-view.fr/wp-json/wp/v2/`. L'authentification est injectée par le proxy de
  l'environnement : pas d'identifiant à saisir. Lecture des brouillons : `?status=draft&context=edit`.
- Gabarit d'article : `elementor_header_footer` (le thème affiche le titre WordPress en H1).
- Auteur habituel des brouillons de la routine : ID 9.

Catégories (ID : nom) :

| ID | Catégorie | Usage |
|---|---|---|
| 22 | SEO | référencement naturel, SEO local |
| 133 | GEO | moteurs IA, AI Overviews, visibilité IA |
| 21 | IA | IA marketing, agents, LLM |
| 17 | SEA | Google Ads, Microsoft Ads, ChatGPT Ads |
| 18 | SMA | Meta, TikTok, LinkedIn Ads |
| 19 | SMO | réseaux sociaux organiques |
| 20 | DATA | GA4, GTM, tracking, consent mode |
| 23 | MMM | marketing mix modeling |
| 25 | CONTENT | content marketing |

Mettre 1 ou 2 catégories, la principale en premier. Ne jamais utiliser 1 (Non classé) ni 16.

URL de catégorie pour le fil d'Ariane : `https://big-view.fr/[slug-catégorie]/` (ex. `/ia/`, `/sea/`,
`/data/`). Attention : `https://big-view.fr/seo/` redirige vers `/agence-seo/` ; pour un article SEO,
mettre `https://big-view.fr/agence-seo/` comme niveau 2 du fil d'Ariane.

## Semrush

- Base de données : `fr`.
- Projet big-view.fr : ID `27065409`. Outils actifs : Site Audit et GAT. **Pas de Position Tracking** :
  pour les positions, utiliser `resource_organic` (outil `organic_research`) sur `big-view.fr`.
- Requête type positions :
  `execute_report("resource_organic", {"target":"big-view.fr","database":"fr","display_filter":[{"field":"keyword","operation":"contains","sign":"+","value":"agence"}],"display_sort":"position_asc","display_limit":100,"export_columns":["keyword","position","previous_position","volume","url"]})`
- Concurrents organiques : `competitors_research` sur big-view.fr, base `fr`.

## Auteur

- Florent Buil, fondateur de Big View, 17 ans d'expérience en acquisition digitale.
- Photo : `https://big-view.fr/wp-content/uploads/2026/02/Florent-Buil.jpg`
