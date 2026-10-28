# Mots-clés stratégiques et maillage interne

## Matrice des mots-clés

8 services × 6 villes = 48 couples « agence [service] [ville] ».

Services : SEO, Google Ads, réseaux sociaux, data, Facebook Ads, TikTok Ads, GEO, IA.
Villes : Paris, Nantes, Rennes, Montpellier, Toulouse, Marseille.

Termes transversaux à placer avec des preuves : expert SEO, expert Google Ads, expert GEO, expert data,
expert IA marketing, consultant senior, stratégie d'acquisition, acquisition digitale.

## Point de départ Semrush (base fr, 28 octobre 2026)

Sur les 48 couples, Big View n'est visible que sur très peu de requêtes « agence » :

| Requête | Position | Volume | Page qui ranke |
|---|---|---|---|
| agence geo marseille | 7 | 90 | page agence Marseille |
| agence sma montpellier | 11 | 140 | page agence Montpellier |
| agence sea montpellier | 16 | 880 | article cas Distripool |
| agence sea toulouse | 24 | 480 | page agence Toulouse |
| agence data paris | 35 | 140 | page agence Paris |
| agence data marketing paris nantes | 37 | 110 | page agence Nantes |
| agence twitch ads | 2 | 70 | /agence-twitch-ads/ |

Tous les autres couples de la matrice sont « non classés » (hors top 100). Reprends toujours les
positions du jour avec Semrush : ce tableau ne sert qu'à repérer une progression.

Lecture utile : quand un article fait ranker une page ville sur une requête (ex. « agence geo marseille »
via la page agence Marseille), le maillage vers cette page est ce qui pousse. Les variantes « sea » et
« sma » sont des synonymes cherchés de « Google Ads » et « réseaux sociaux » : à placer naturellement.

## Règles de rotation

1. Priorité : positions 4 à 20, puis 21 à 50, puis non classé dont le service colle au sujet.
2. Pas le même couple deux semaines de suite, sauf s'il stagne (moins de 3 places gagnées).
3. Pas la même ville plus d'une fois sur trois semaines si une autre option tient la route.
4. Équilibre les services sur le mois : les derniers articles ont surtout visé GEO, SEO et Google Ads.
   Data, réseaux sociaux, TikTok Ads et IA sont sous-servis : à privilégier quand le sujet le permet.
5. Le script `inventaire_site.py` liste les couples des derniers articles et brouillons : lis-le avant de
   choisir.

## Pages cibles du maillage

Pages ville par service (existantes) :

| Service | Paris | Nantes | Rennes | Montpellier | Toulouse | Marseille |
|---|---|---|---|---|---|---|
| SEO | /agence-seo/seo-geo-paris/ | /agence-seo/seo-geo-nantes/ | /agence-seo/seo-geo-rennes/ | /agence-seo/seo-geo-montpellier/ | /agence-seo/seo-geo-toulouse/ | /agence-seo/seo-geo-marseille/ |
| Google Ads | /agence-google-ads/paris/ | /agence-google-ads/nantes/ | /agence-google-ads/rennes/ | /agence-google-ads/montpellier/ | /agence-google-ads/toulouse/ | /agence-google-ads/marseille/ |

Pages agence par ville (tous services) :

| Ville | URL |
|---|---|
| Paris | /agence-paris-seo-sea-data-ia/ |
| Nantes | /agence-nantes-acquisition-seo-sea-reseaux-sociaux-data-ia/ |
| Rennes | /agence-rennes-acquisition-seo-sea-reseaux-sociaux-data/ |
| Montpellier | /agence-seo-sea-montpellier/ |
| Toulouse | /agence-toulouse-acquisition-seo-sea-reseaux-sociaux-data-ia/ |
| Marseille | /agence-marseille-acquisition-seo-sea-reseaux-sociaux-data-ia/ |

Pages service nationales :

| Service | URL | Sous-pages utiles |
|---|---|---|
| SEO | /agence-seo/ | /audit-seo/, /strategie-editoriale-seo/, /agence-seo/optimisation-technique-seo/, /agence-seo/tracking-roi-seo/, /agence-netlinking/ |
| Google Ads | /agence-google-ads/ | /agence-google-ads/audit-strategie-sea/, /agence-google-ads/structuration-tracking-sea/, /agence-google-ads/optimisation-continue-sea/ |
| Paid (hub) | /agence-sea/ | /agence-microsoft-bing-ads/, /agence-chatgpt-ads/, /agence-youtube-ads/ |
| GEO | /agence-geo/ | /agence-geo/audit-visibilite-ia/, /agence-geo/contenu-citable/, /agence-geo/structuration-semantique-llm/, /agence-geo/renforcement-eeat/, /agence-geo/monitoring-ia/, /geo-share-of-voice/ |
| IA | /agence-ia-marketing/ | /gem-gemini/ |
| Data | /agence-data-performante/ | |
| Facebook Ads | /agence-meta-facebook-instagram-ads/ | |
| TikTok Ads | /agence-tiktok-ads/ | |
| Réseaux sociaux | pas de page dédiée : /agence-meta-facebook-instagram-ads/, /agence-linkedin-ads/, /agence-tiktok-ads/ | |
| Content | /content-marketing/ | /content-marketing/strategie-contenu/ |

Préfixe toujours `https://big-view.fr`. Vérifie avec l'inventaire que la page existe encore.

**Couples sans page ville** (GEO, IA, data, réseaux sociaux, Facebook Ads, TikTok Ads) : lie la page
service nationale avec une ancre service (« accompagnement GEO », « expert data ») et la page agence de
la ville avec une ancre locale (« notre agence de Rennes »). Signale dans le résumé que la création d'une
page « agence [service] [ville] » accélérerait le positionnement : c'est une opportunité récurrente.

## Ancres

- Descriptives, variées, en contexte : « audit de visibilité IA », « agence Google Ads à Toulouse »,
  « notre méthode de pilotage à la marge ».
- Une même ancre exacte au plus une fois par article. Ancre exacte du mot-clé principal : une seule fois,
  vers la page la plus proche du couple.
- Jamais : « cliquez ici », « ici », « en savoir plus », « cet article ».
- Pas de lien dans les blocs de réponse directe (`bvc-answer`) : ils doivent rester lisibles hors contexte.

## Liens entrants à proposer

Choisis 2 à 4 articles existants qui (1) traitent un sujet voisin, (2) sont publiés, (3) ont de
préférence du trafic ou des positions (vérifie avec `resource_organic` filtré sur leur URL si le temps le
permet). Pour chacun : URL source, phrase existante où placer le lien (ou phrase à ajouter), ancre
proposée.
