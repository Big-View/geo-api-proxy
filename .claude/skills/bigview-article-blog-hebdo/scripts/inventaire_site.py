#!/usr/bin/env python3
"""Inventaire de big-view.fr pour la routine d'article hebdomadaire.

Sort : articles publiés et brouillons (anti-doublon), couples « service + ville »
visés récemment (rotation des mots-clés), pages services et villes (maillage).

Usage : python3 inventaire_site.py [--json] [--recents 10]
L'authentification WordPress est injectée par le proxy : on passe par curl.
"""
import argparse
import html
import json
import re
import subprocess
import sys
import unicodedata

API = "https://big-view.fr/wp-json/wp/v2"

SERVICES = [  # ordre important : du plus précis au plus large
    ("Facebook Ads", r"facebook ads|meta ads|instagram ads"),
    ("TikTok Ads", r"tiktok ads"),
    ("Google Ads", r"google ads|\bsea\b"),
    ("réseaux sociaux", r"reseaux sociaux|social ads|\bsma\b|\bsmo\b"),
    ("data", r"\bdata\b|analytics"),
    ("GEO", r"\bgeo\b"),
    ("IA", r"\bia\b"),
    ("SEO", r"\bseo\b"),
]
VILLES = ["Paris", "Nantes", "Rennes", "Montpellier", "Toulouse", "Marseille"]


def norm(s):
    s = html.unescape(s or "").lower()
    s = unicodedata.normalize("NFD", s)
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def get(url):
    out = subprocess.run(["curl", "-s", "--max-time", "60", url], capture_output=True, text=True)
    try:
        return json.loads(out.stdout)
    except json.JSONDecodeError:
        sys.exit(f"Réponse illisible pour {url} : {out.stdout[:200]} {out.stderr[:200]}")


def get_all(endpoint, params):
    items, page = [], 1
    while True:
        data = get(f"{API}/{endpoint}?per_page=100&page={page}&{params}")
        if isinstance(data, dict):  # fin de pagination ou erreur
            if data.get("code") == "rest_post_invalid_page_number":
                break
            sys.exit(f"Erreur API {endpoint} : {data}")
        items += data
        if len(data) < 100:
            break
        page += 1
    return items


def couple(title, focus):
    """Repère le couple (service, ville) visé, d'abord via le titre « Agence X à Ville »."""
    t = norm(title)
    m = re.search(r"agence (.{2,30}?) a (paris|nantes|rennes|montpellier|toulouse|marseille)", t)
    candidats = [m.group(1)] if m else []
    candidats.append(norm(focus))
    for c in candidats:
        for nom, motif in SERVICES:
            if re.search(motif, c):
                ville = next((v for v in VILLES if norm(v) in (t + " " + norm(focus))), None)
                return nom, ville
    return None, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--recents", type=int, default=10)
    a = ap.parse_args()

    cats = {c["id"]: c["name"] for c in get(f"{API}/categories?per_page=100&_fields=id,name")}
    champs = "_fields=id,date,status,link,slug,title,categories,meta&context=edit"
    posts = get_all("posts", f"status=publish,draft,pending,future&{champs}")
    pages = get_all("pages", "status=publish&_fields=link,title")

    lignes = []
    for p in posts:
        meta = p.get("meta") or {}
        titre = html.unescape(p["title"].get("raw") or p["title"].get("rendered", ""))
        focus = meta.get("_yoast_wpseo_focuskw", "") if isinstance(meta, dict) else ""
        service, ville = couple(titre, focus)
        lignes.append({
            "id": p["id"], "date": p["date"][:10], "statut": p["status"], "titre": titre,
            "url": p.get("link"), "categories": [cats.get(c, c) for c in p["categories"]],
            "focus_yoast": focus, "service": service, "ville": ville,
        })
    lignes.sort(key=lambda x: x["date"], reverse=True)

    pages_l = sorted(
        ({"titre": html.unescape(p["title"]["rendered"]), "url": p["link"]} for p in pages),
        key=lambda x: x["url"],
    )

    if a.json:
        print(json.dumps({"articles": lignes, "pages": pages_l}, ensure_ascii=False, indent=1))
        return

    print(f"## Articles et brouillons ({len(lignes)})")
    for l in lignes:
        print(f"{l['date']} [{l['statut']}] {l['titre']} | {', '.join(map(str, l['categories']))} | {l['url']}")

    print(f"\n## Couples visés par les {a.recents} contenus les plus récents (rotation)")
    for l in lignes[: a.recents]:
        c = f"{l['service'] or '?'} + {l['ville'] or 'national'}"
        print(f"{l['date']} [{l['statut']}] {c:28} focus Yoast : « {l['focus_yoast']} »")
        if l["service"] and l["focus_yoast"] and "agence" not in norm(l["focus_yoast"]):
            print("    ! focus Yoast différent du couple service + ville")

    print("\n## Pages (cibles de maillage)")
    for p in pages_l:
        print(f"{p['url']} | {p['titre']}")


if __name__ == "__main__":
    main()
