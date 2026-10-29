#!/usr/bin/env python3
"""Crée ou met à jour un BROUILLON d'article sur big-view.fr (jamais de publication).

Usage :
  python3 publier_brouillon.py article.html --titre "..." --slug "..." --categories 133,21 \
      --mot-cle "agence geo rennes" --titre-seo "..." --meta "..." [--id 12345] [--image-une 678]

--id : met à jour un brouillon existant (refusé si l'article n'est pas en brouillon).
L'authentification est injectée par le proxy de l'environnement : on passe par curl.
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile

API = "https://big-view.fr/wp-json/wp/v2/posts"


def curl(args):
    out = subprocess.run(["curl", "-s", "--max-time", "120"] + args, capture_output=True, text=True)
    try:
        return json.loads(out.stdout)
    except json.JSONDecodeError:
        sys.exit(f"Réponse illisible : {out.stdout[:300]} {out.stderr[:300]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("fichier")
    ap.add_argument("--titre", required=True)
    ap.add_argument("--slug", required=True)
    ap.add_argument("--categories", required=True, help="IDs séparés par des virgules, ex. 133,21")
    ap.add_argument("--mot-cle", required=True)
    ap.add_argument("--titre-seo", required=True)
    ap.add_argument("--meta", required=True)
    ap.add_argument("--id", type=int)
    ap.add_argument("--image-une", type=int, help="ID média de l'image à la une (visuel couverture)")
    a = ap.parse_args()

    html = open(a.fichier, encoding="utf-8").read().strip()
    if not html.startswith("<!-- wp:html -->"):
        html = "<!-- wp:html -->\n" + html + "\n<!-- /wp:html -->"

    payload = {
        "title": a.titre,
        "slug": a.slug,
        "status": "draft",  # ne jamais changer : Florent publie lui-même
        "template": "elementor_header_footer",
        "categories": [int(c) for c in a.categories.split(",") if c.strip()],
        "excerpt": a.meta,
        "content": html,
        "meta": {
            "_yoast_wpseo_focuskw": a.mot_cle,
            "_yoast_wpseo_title": a.titre_seo,
            "_yoast_wpseo_metadesc": a.meta,
        },
    }

    if a.image_une:
        payload["featured_media"] = a.image_une

    url = API
    if a.id:
        actuel = curl([f"{API}/{a.id}?context=edit&_fields=status"])
        if actuel.get("status") != "draft":
            sys.exit(f"Refus : l'article {a.id} n'est pas un brouillon ({actuel}).")
        url = f"{API}/{a.id}"

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
        chemin = f.name
    try:
        rep = curl(["-X", "POST", url, "-H", "Content-Type: application/json; charset=utf-8", "--data-binary", f"@{chemin}"])
    finally:
        os.unlink(chemin)
    if "id" not in rep:
        sys.exit(f"Échec de création : {json.dumps(rep, ensure_ascii=False)[:500]}")

    pid = rep["id"]
    verif = curl([f"{API}/{pid}?context=edit&_fields=status,content,meta,template,link,featured_media"])
    enregistre = verif["content"]["raw"].strip()
    ok_contenu = hashlib.sha256(enregistre.encode()).hexdigest() == hashlib.sha256(html.encode()).hexdigest()
    meta = verif.get("meta", {})
    print(json.dumps({
        "id": pid,
        "statut": verif.get("status"),
        "gabarit": verif.get("template"),
        "contenu_identique": ok_contenu,
        "longueur_locale": len(html),
        "longueur_enregistree": len(enregistre),
        "image_a_la_une": verif.get("featured_media"),
        "yoast_focus": meta.get("_yoast_wpseo_focuskw"),
        "yoast_titre": meta.get("_yoast_wpseo_title"),
        "yoast_meta": meta.get("_yoast_wpseo_metadesc"),
        "apercu": f"https://big-view.fr/?p={pid}&preview=true",
        "edition": f"https://big-view.fr/wp-admin/post.php?post={pid}&action=edit",
    }, ensure_ascii=False, indent=1))
    if verif.get("status") != "draft" or not ok_contenu:
        sys.exit("Attention : statut ou contenu inattendu, vérifier le brouillon.")


if __name__ == "__main__":
    main()
