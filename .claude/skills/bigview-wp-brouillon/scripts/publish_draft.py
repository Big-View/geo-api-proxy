#!/usr/bin/env python3
"""Crée un article BROUILLON sur big-view.fr à partir d'un HTML + d'un JSON de métadonnées.

Usage :
  python3 publish_draft.py <article.html> <article.json> [--dry-run] [--workdir DIR]

Le script ne publie jamais : le statut envoyé est toujours "draft".
L'authentification est injectée par le proxy réseau (secret « WordPress Big View ») :
aucun identifiant n'est lu, stocké ni affiché ici.

Sortie : un rapport JSON sur stdout. Code retour 0 = brouillon créé (ou dry-run OK),
2 = API non connectée, 3 = slug déjà pris (rien fait), 1 = autre erreur.
"""
import argparse
import html as htmllib
import json
import os
import re
import subprocess
import sys
import tempfile

API = "https://big-view.fr/wp-json/wp/v2"
HERE = os.path.dirname(os.path.abspath(__file__))
REQUIRED = ["title", "slug", "categories", "excerpt", "seo_title", "metadesc"]


def curl(method, url, data_file=None, headers=None, binary=None):
    """Appel HTTP via curl (passe par le proxy qui injecte l'auth). Renvoie (code, corps)."""
    cmd = ["curl", "-sS", "-X", method, "-o", "-", "-w", "\n%{http_code}", url]
    for h in headers or []:
        cmd += ["-H", h]
    if data_file:
        cmd += ["-H", "Content-Type: application/json; charset=utf-8", "--data-binary", "@" + data_file]
    if binary:
        cmd += ["--data-binary", "@" + binary]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    body, _, code = out.stdout.rpartition("\n")
    try:
        return int(code), json.loads(body) if body.strip() else None
    except json.JSONDecodeError:
        return int(code or 0), body[:300]


def post_json(url, payload, workdir):
    path = os.path.join(workdir, "payload.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)
    return curl("POST", url, data_file=path)


def fail(report, code, msg):
    report["ok"] = False
    report["erreur"] = msg
    print(json.dumps(report, ensure_ascii=False, indent=2))
    sys.exit(code)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("html")
    ap.add_argument("meta")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--workdir", default=None)
    a = ap.parse_args()
    workdir = a.workdir or tempfile.mkdtemp(prefix="bv-draft-")
    os.makedirs(workdir, exist_ok=True)
    report = {"fichier": os.path.basename(a.html), "dry_run": a.dry_run, "etapes": []}

    meta = json.load(open(a.meta, encoding="utf-8"))
    missing = [k for k in REQUIRED if not meta.get(k)]
    if missing:
        fail(report, 1, f"Champs manquants dans {os.path.basename(a.meta)} : {missing}")
    meta.setdefault("template", "elementor_header_footer")
    if len(meta["seo_title"]) > 60 or len(meta["metadesc"]) > 155:
        report["etapes"].append(f"ATTENTION longueurs Yoast : titre {len(meta['seo_title'])}/60, meta {len(meta['metadesc'])}/155")

    # 1. Test d'authentification
    code, me = curl("GET", f"{API}/users/me?context=edit")
    if code != 200 or not isinstance(me, dict) or "id" not in me:
        msg = me.get("message") if isinstance(me, dict) else me
        fail(report, 2, f"GET /wp-json/wp/v2/users/me → HTTP {code} : {msg}")
    report["compte"] = {"nom": me.get("name"), "role": me.get("roles")}
    caps = me.get("capabilities", {})
    if not caps.get("unfiltered_html"):
        report["etapes"].append("ATTENTION : pas de droit unfiltered_html, WordPress filtrera <style>/<script>")

    # 2. Slug libre (tous statuts) et catégories existantes
    code, found = curl("GET", f"{API}/posts?slug={meta['slug']}&status=publish,draft,pending,private,future&context=edit&_fields=id,status")
    if code == 200 and found:
        report["existant"] = found
        fail(report, 3, f"Slug « {meta['slug']} » déjà utilisé (id {found[0]['id']}, {found[0]['status']}) : rien créé")
    ids = ",".join(str(c) for c in meta["categories"])
    code, cats = curl("GET", f"{API}/categories?include={ids}&_fields=id,name")
    if code != 200 or len(cats or []) != len(meta["categories"]):
        fail(report, 1, f"Catégories introuvables : demandé {meta['categories']}, trouvé {cats}")
    report["categories"] = [c["name"] for c in cats]

    # 3. Nettoyage du HTML
    src = open(a.html, encoding="utf-8").read().strip()
    src = src.removeprefix("<!-- wp:html -->").removesuffix("<!-- /wp:html -->").strip()
    src, n_h1 = re.subn(r"<h1[^>]*>.*?</h1>\s*", "", src, flags=re.S)
    if n_h1:
        report["etapes"].append(f"{n_h1} H1 retiré(s) (le gabarit affiche déjà le titre)")

    # 4. Infographies SVG → PNG dans la médiathèque
    svgs = list(re.finditer(r"<svg\b.*?</svg>", src, flags=re.S))
    images = []
    for i, m in enumerate(svgs, 1):
        svg = m.group(0)
        t = re.search(r"<title[^>]*>(.*?)</title>", svg, flags=re.S)
        alt = htmllib.unescape(t.group(1).strip()) if t else f"Infographie {i}"
        svg_path = os.path.join(workdir, f"infographie-{i}.svg")
        png_path = os.path.join(workdir, f"{meta['slug']}-infographie-{i}.png")
        open(svg_path, "w", encoding="utf-8").write(svg)
        r = subprocess.run(["node", os.path.join(HERE, "svg_to_png.mjs"), svg_path, png_path],
                           capture_output=True, text=True, timeout=120)
        if r.returncode != 0 or not os.path.exists(png_path):
            fail(report, 1, f"Rendu PNG de l'infographie {i} impossible : {r.stderr[-300:]}")
        dims = json.loads(r.stdout.strip().splitlines()[-1])
        img = {"alt": alt, "png": png_path, "w": dims["width"], "h": dims["height"]}
        if not a.dry_run:
            code, media = curl("POST", f"{API}/media", binary=png_path, headers=[
                "Content-Type: image/png",
                f"Content-Disposition: attachment; filename={os.path.basename(png_path)}"])
            if code not in (200, 201):
                fail(report, 1, f"Upload infographie {i} → HTTP {code} : {media}")
            post_json(f"{API}/media/{media['id']}", {"alt_text": alt, "title": alt}, workdir)
            img.update(id=media["id"], url=media["source_url"])
        images.append(img)
    for img, m in reversed(list(zip(images, svgs))):
        url = img.get("url", "IMAGE_DRY_RUN")
        tag = (f'<img src="{url}" alt="{htmllib.escape(img["alt"])}" width="{img["w"]}" '
               f'height="{img["h"]}" loading="lazy" decoding="async" style="width:100%;height:auto;border-radius:20px">')
        src = src[:m.start()] + tag + src[m.end():]
    report["infographies"] = [{k: v for k, v in im.items() if k != "png"} for im in images]

    content = "<!-- wp:html -->\n" + src + "\n<!-- /wp:html -->"
    open(os.path.join(workdir, "content.html"), "w", encoding="utf-8").write(content)
    report["controles_contenu"] = {
        "img": content.count("<img"), "svg_restants": content.count("<svg"),
        "json_ld": content.count("application/ld+json"), "h1": content.count("<h1")}
    if a.dry_run:
        report["ok"] = True
        report["contenu_prepare"] = os.path.join(workdir, "content.html")
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return

    # 5. Création du brouillon. _elementor_edit_mode vide : WordPress rend le contenu
    # lui-même, sinon Elementor sert une version en cache sans infographies ni JSON-LD.
    payload = {
        "title": meta["title"], "slug": meta["slug"], "status": "draft",
        "categories": meta["categories"], "excerpt": meta["excerpt"],
        "template": meta["template"], "content": content,
        "meta": {"_elementor_edit_mode": "", "_yoast_wpseo_title": meta["seo_title"],
                 "_yoast_wpseo_metadesc": meta["metadesc"]},
    }
    if meta.get("focuskw"):
        payload["meta"]["_yoast_wpseo_focuskw"] = meta["focuskw"]
    code, post = post_json(f"{API}/posts", payload, workdir)
    if code != 201:
        fail(report, 1, f"Création du brouillon → HTTP {code} : {post}")
    pid = post["id"]

    # 6. Vérification après coup
    code, chk = curl("GET", f"{API}/posts/{pid}?context=edit")
    raw, rendered, m = chk["content"]["raw"], chk["content"]["rendered"], chk["meta"]
    report["brouillon"] = {
        "id": pid, "statut": chk["status"],
        "edition": f"https://big-view.fr/wp-admin/post.php?post={pid}&action=edit",
        "permalien_prevu": chk.get("permalink_template", "").replace("%postname%", meta["slug"]) or chk.get("link"),
        "contenu_identique": raw == content,
        "rendu_img": rendered.count("<img"), "rendu_json_ld": rendered.count("ld+json"),
        "gabarit": chk.get("template"), "elementor_edit_mode": m.get("_elementor_edit_mode"),
        "yoast_titre": m.get("_yoast_wpseo_title"), "yoast_metadesc": m.get("_yoast_wpseo_metadesc"),
    }
    b = report["brouillon"]
    report["ok"] = (b["statut"] == "draft" and b["contenu_identique"] and b["elementor_edit_mode"] == ""
                    and b["yoast_titre"] == meta["seo_title"])
    # Le JSON-LD doit pointer vers le vrai permalien
    ld_urls = set(re.findall(r'"mainEntityOfPage":\s*"([^"]+)"', content))
    if ld_urls and b["permalien_prevu"] and b["permalien_prevu"] not in ld_urls:
        report["etapes"].append(f"ATTENTION JSON-LD mainEntityOfPage {ld_urls} ≠ permalien {b['permalien_prevu']}")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    sys.exit(0 if report["ok"] else 1)


if __name__ == "__main__":
    main()
