# Visuels de l'article

Un article Big View sans visuel est un mur de texte : il se lit mal, se partage mal et donne moins de
matière aux moteurs IA (les images avec un texte alternatif précis sont indexées et parfois reprises).
Chaque article a donc **une image à la une et 4 à 7 visuels dans le corps**, aux couleurs de la charte.

## Règles

- Un visuel = une idée, lisible en 3 secondes. Il reprend un chiffre, une comparaison, une chronologie
  ou une méthode **déjà écrits et sourcés dans l'article**. Aucun chiffre nouveau dans une image.
- Répartition : un visuel toutes les 1 ou 2 sections H2. Pas de visuel dans la FAQ ni dans le CTA final.
- Chaque visuel porte sa source en pied (si chiffres) et la signature « Big View · big-view.fr ».
- Texte alternatif : une phrase qui décrit le contenu et contient le chiffre clé (pas « infographie »).
  Le mot-clé principal dans l'alt de l'image à la une et d'au plus un autre visuel.
- Légende (figcaption) : la conclusion à retenir, en une phrase.
- Pas de logo Big View dans les visuels (le thème l'affiche déjà) ; jamais de logo sur fond noir.
- Pas de capture client non anonymisée. Les captures d'outils Big View sont bienvenues si anonymisées.

## Choisir les visuels

| Contenu de la section | Type | Exemple |
|---|---|---|
| 2 à 4 chiffres clés sourcés | `chiffres` | part du trafic IA, prix d'entrée, date de lancement |
| Une comparaison de valeurs | `barres` | avant / après, canal A / canal B |
| Des dates qui racontent une évolution | `frise` | annonces d'une plateforme sur l'année |
| Une méthode, un plan d'action | `etapes` | plan en 6 étapes |
| 2 à 4 options ou couches à comparer | `cartes` | 3 couches de mesure, 3 formules |
| Image à la une (1200 × 630) | `couverture` | titre de l'article, kicker = mot-clé |

Le tableau HTML (`bvc-table`) reste utile pour les comparaisons détaillées : il compte comme un
élément visuel pour la lecture mais pas dans le minimum de 4 images.

## Fabrication (scripts du skill)

1. Écris `spec.json` :
   ```json
   {
    "slug": "agence-data-paris-mesurer-chatgpt-ga4",
    "visuels": [
     {"id": "couverture", "type": "couverture", "kicker": "Agence data Paris",
      "titre": "Mesurer ce que [[ChatGPT]] vous rapporte", "sous_titre": "…", "alt": "…"},
     {"id": "chiffres-cles", "type": "chiffres", "kicker": "…", "titre": "Un canal encore [[petit]]",
      "items": [{"valeur": "0,26 %", "libelle": "du trafic …"}], "source": "SE Ranking 2026",
      "alt": "…", "legende": "…", "apres_h2": "Que change ChatGPT"},
     {"id": "bug", "type": "barres", "items": [{"libelle": "…", "valeur": 31000, "affichage": "≈ -31 000 / jour"}], "…": "…"},
     {"id": "frise", "type": "frise", "items": [{"date": "24 mars", "titre": "…", "texte": "…", "important": true}]},
     {"id": "plan", "type": "etapes", "items": [{"titre": "…", "texte": "…"}]},
     {"id": "couches", "type": "cartes", "items": [{"titre": "1. GA4", "lignes": ["+ ce qu'elle voit", "- ce qu'elle rate"]}]}
    ]
   }
   ```
   `[[mot]]` dans un titre = mot en vert. `apres_h2` = extrait du texte du H2 sous lequel placer l'image.
   Champs communs : `kicker`, `titre`, `sous_titre`, `source`, `alt`, `legende`, `apres_h2`.
   `chiffres` accepte `colonnes` (3 ou 4).
2. `node scripts/visuels.mjs spec.json visuels/` : rendu WebP 1200 px de large + `manifeste.json`.
3. **Regarde chaque image** (outil de lecture d'image) : texte coupé, chevauchement, faute. Corrige le
   spec et relance si besoin.
4. `python3 scripts/envoyer_visuels.py spec.json visuels/ article.html` : envoi dans la médiathèque,
   alt et légende, insertion des `<figure>` dans l'article, ID de l'image à la une dans
   `visuels/image_a_la_une.txt`.
5. Ajoute l'URL de l'image à la une dans le JSON-LD Article (`"image"`), puis publie avec
   `publier_brouillon.py … --image-une $(cat visuels/image_a_la_une.txt)`.

Si WordPress est inaccessible, fabrique quand même les visuels (étapes 1 à 3), dépose les WebP dans le
même dossier Drive que le Google Doc de repli et indique dans le Doc où placer chacun.
Si le navigateur ou Node ne sont pas disponibles, décris chaque visuel prévu (type, contenu, alt,
emplacement) dans le Doc pour qu'il soit produit au moment de la mise en brouillon.
