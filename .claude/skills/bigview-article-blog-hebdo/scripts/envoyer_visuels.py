#!/usr/bin/env python3
"""Envoie les visuels dans la médiathèque big-view.fr et les insère dans l'article.

Usage :
  python3 envoyer_visuels.py spec.json dossier_visuels article.html

- Lit dossier_visuels/manifeste.json (produit par visuels.mjs) et spec.json (champ « apres_h2 »).
- Envoie chaque WebP dans la médiathèque (POST /wp/v2/media), renseigne texte alternatif et légende.
- Insère une <figure class="bvc-fig"> dans article.html, juste après le premier paragraphe
  qui suit la réponse directe du H2 dont le texte contient « apres_h2 ».
  Le visuel de type « couverture » n'est pas inséré : son ID est écrit dans
  dossier_visuels/image_a_la_une.txt (à passer à publier_brouillon.py --image-une).
- Écrit dossier_visuels/medias.json (id, url de chaque visuel).
Idempotent sur l'article : un visuel déjà présent (même URL de fichier) n'est pas réinséré.
"""
import json
import os
import re
import subprocess
import sys

API = "https://big-view.fr/wp-json/wp/v2/media"


def curl(args):
    out = subprocess.run(["curl", "-s", "--max-time", "120"] + args, capture_output=True, text=True)
    try:
        return json.loads(out.stdout)
    except json.JSONDecodeError:
        sys.exit(f"Réponse illisible : {out.stdout[:300]} {out.stderr[:300]}")


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    spec_path, dossier, article = sys.argv[1:]
    spec = {v["id"]: v for v in json.load(open(spec_path, encoding="utf-8"))["visuels"]}
    manifeste = json.load(open(os.path.join(dossier, "manifeste.json"), encoding="utf-8"))
    html = open(article, encoding="utf-8").read()
    medias = []

    for m in manifeste:
        nom = os.path.basename(m["fichier"])
        rep = curl(["-X", "POST", API, "-H", f"Content-Disposition: attachment; filename={nom}",
                    "-H", "Content-Type: image/webp", "--data-binary", f"@{m['fichier']}"])
        if "id" not in rep:
            sys.exit(f"Échec de l'envoi de {nom} : {json.dumps(rep, ensure_ascii=False)[:300]}")
        curl(["-X", "POST", f"{API}/{rep['id']}", "-H", "Content-Type: application/json; charset=utf-8",
              "--data-binary", json.dumps({"alt_text": m["alt"], "caption": m.get("legende", ""),
                                           "title": m["alt"][:90]}, ensure_ascii=False)])
        url = rep["source_url"]
        medias.append({"id": m["id"], "media_id": rep["id"], "url": url})
        print(f"Envoyé : {nom} -> média {rep['id']}")

        if m["type"] == "couverture":
            open(os.path.join(dossier, "image_a_la_une.txt"), "w").write(str(rep["id"]))
            continue
        if url in html:
            continue
        cible = spec[m["id"]].get("apres_h2")
        fig = (f'\n<figure class="bvc-fig"><img src="{url}" alt="{m["alt"]}" width="{m["largeur"]}" '
               f'height="{m["hauteur"]}" loading="lazy" decoding="async" '
               f'style="width:100%;height:auto;border-radius:20px">'
               f'{"<figcaption>" + m["legende"] + "</figcaption>" if m.get("legende") else ""}</figure>\n')
        # Repère le H2 cible, puis la fin du premier paragraphe non « réponse directe » qui le suit
        pos = None
        for h in re.finditer(r"<h2[^>]*>(.*?)</h2>", html, re.S):
            if cible and cible.lower() in re.sub("<[^>]+>", "", h.group(1)).lower():
                suite = html[h.end():]
                p = re.search(r'<p(?![^>]*bvc-answer)[^>]*>.*?</p>', suite, re.S)
                prochain_h2 = suite.find("<h2")
                if p and (prochain_h2 == -1 or p.start() < prochain_h2):
                    pos = h.end() + p.end()
                else:  # pas de paragraphe : après la réponse directe
                    a = re.search(r"</p>", suite)
                    pos = h.end() + a.end()
                break
        if pos is None:
            print(f"  ! H2 « {cible} » introuvable : {m['id']} non inséré")
            continue
        html = html[:pos] + fig + html[pos:]

    open(article, "w", encoding="utf-8").write(html)
    json.dump(medias, open(os.path.join(dossier, "medias.json"), "w"), ensure_ascii=False, indent=1)
    print(f"Article mis à jour : {html.count('bvc-fig\"')} figure(s).")


if __name__ == "__main__":
    main()
