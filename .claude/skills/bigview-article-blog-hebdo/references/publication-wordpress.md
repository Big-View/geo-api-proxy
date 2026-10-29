# Mise en brouillon WordPress

L'API REST de big-view.fr est authentifiée par le proxy de l'environnement : `curl` suffit, sans
identifiant. Ne saisis jamais de mot de passe.

## Méthode recommandée : le script

```bash
python3 scripts/publier_brouillon.py article.html \
  --titre "Agence GEO à Rennes : ..." \
  --slug "agence-geo-rennes-sujet-court" \
  --categories 133,21 \
  --mot-cle "agence geo rennes" \
  --titre-seo "Agence GEO Rennes : ..." \
  --meta "Agence GEO à Rennes : ..."
```

Le script force `status: draft`, applique le gabarit `elementor_header_footer`, enveloppe le contenu
dans un bloc HTML, renseigne l'extrait et les trois champs Yoast, puis relit le brouillon et compare la
longueur et l'empreinte SHA-256 du contenu enregistré avec la version locale. Il affiche l'ID, le lien
d'aperçu et le lien d'édition. Ajoute `--id 12345` pour mettre à jour un brouillon existant de la même
session plutôt que d'en créer un second.

## Méthode manuelle (si le script échoue)

1. Prépare un fichier JSON :
   ```json
   {
     "title": "…",
     "slug": "…",
     "status": "draft",
     "template": "elementor_header_footer",
     "categories": [133, 21],
     "excerpt": "<meta description>",
     "content": "<!-- wp:html -->\n…HTML…\n<!-- /wp:html -->",
     "meta": {
       "_yoast_wpseo_focuskw": "agence geo rennes",
       "_yoast_wpseo_title": "…",
       "_yoast_wpseo_metadesc": "…"
     }
   }
   ```
2. `curl -s -X POST https://big-view.fr/wp-json/wp/v2/posts -H "Content-Type: application/json" --data @brouillon.json`
3. Relis : `curl -s "https://big-view.fr/wp-json/wp/v2/posts/ID?context=edit&_fields=status,content,meta"`
   et vérifie `status = draft`, longueur du contenu, champs Yoast.
4. Si la requête est coupée (contenu très long), crée d'abord le brouillon avec un contenu court, puis
   mets à jour le contenu par morceaux de ~9 000 caractères en l'ajoutant au contenu déjà enregistré, et
   vérifie la longueur à chaque étape.

## Images

Passe par `scripts/envoyer_visuels.py` (voir `references/visuels.md`) : envoi dans la médiathèque,
texte alternatif, légende, insertion dans l'article et ID de l'image à la une. À la main :
`POST /wp/v2/media` avec `Content-Disposition: attachment; filename=…webp` et `--data-binary @fichier`,
puis `POST /wp/v2/media/ID` avec `alt_text`, et `featured_media` sur l'article.

## Interdits

- `status` autre que `draft` (pas de `publish`, `future`, `pending`).
- Modifier un article publié ou un brouillon qui n'a pas été créé dans la session.
- Supprimer quoi que ce soit.

## Si WordPress est inaccessible

Crée un Google Doc dans Drive intitulé « ARTICLE BLOG à mettre en brouillon : [titre] » avec : titre,
slug, catégories, champs Yoast, extrait, texte lisible de l'article, puis le HTML complet en fin de
document. Mets le lien du Doc dans Notion et en tête du résumé.
