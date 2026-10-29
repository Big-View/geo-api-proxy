#!/usr/bin/env python3
"""Contrôle qualité d'un article big-view.fr avant mise en brouillon.

Usage :
  python3 controle_article.py article.html --titre "..." --titre-seo "..." --meta "..." \
      --mot-cle "agence geo rennes" [--secondaires "a,b,c"] [--hors-ligne]

Sortie : une ligne par contrôle (OK / ALERTE / ÉCHEC). Code de sortie 1 s'il reste un ÉCHEC.
--hors-ligne : ne vérifie pas que les liens internes répondent en 200.
"""
import argparse
import html
import json
import re
import subprocess
import sys
import unicodedata

STOP = {"a", "au", "aux", "de", "des", "du", "en", "la", "le", "les", "l", "d", "sur", "pour", "et"}
CATEGORIES_BLOG = ("seo", "ia", "sea", "data", "sma", "smo", "content", "mmm", "geo", "non-classe")
ANCRES_INTERDITES = {"cliquez ici", "ici", "en savoir plus", "cet article", "lire la suite", "voir ici", "ce lien"}
INTENSIFS = ["véritable", "incontournable", "révolutionn", "crucial", "game changer", "booster",
             "dans un monde où", "plongeons", "il est important de noter", "en conclusion", "au cœur de"]

resultats = []


def r(niveau, msg):
    resultats.append((niveau, msg))


def norm(s):
    s = html.unescape(s or "").lower().replace("’", "'")
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    mots = re.findall(r"[a-z0-9]+", s)
    return " ".join(m for m in mots if m not in STOP)


def contient(texte, cle):
    return norm(cle) in norm(texte)


def texte(h):
    h = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", h, flags=re.S | re.I)
    h = re.sub(r"<!--.*?-->", " ", h, flags=re.S)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", h))).strip()


def mots(s):
    return len(re.findall(r"[\wÀ-ÿ'’-]+", s))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("fichier")
    ap.add_argument("--titre", required=True)
    ap.add_argument("--titre-seo", required=True)
    ap.add_argument("--meta", required=True)
    ap.add_argument("--mot-cle", required=True)
    ap.add_argument("--secondaires", default="")
    ap.add_argument("--hors-ligne", action="store_true")
    a = ap.parse_args()

    h = open(a.fichier, encoding="utf-8").read()
    corps = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", h, flags=re.S | re.I)
    corps_sans_commentaires = re.sub(r"<!--.*?-->", " ", corps, flags=re.S)
    visible = texte(h)
    kw = a.mot_cle

    # Marque
    tout = visible + " " + a.titre + " " + a.titre_seo + " " + a.meta
    sans_url = re.sub(r"https?://\S+", " ", tout)
    fautes = re.findall(r"\b(BigView|Bigview|bigview|BIGVIEW|bigview\.fr|Big-View)\b", sans_url)
    r("ÉCHEC" if fautes else "OK", f"Nom de marque : {len(fautes)} graphie(s) fautive(s) {sorted(set(fautes))}" if fautes else "Nom de marque : « Big View » partout")
    tirets = tout.count("—") + len(re.findall(r"\s–\s", tout))
    r("ÉCHEC" if tirets else "OK", f"Tirets cadratins ou d'incise : {tirets}")
    slogans = re.findall(r"L['’]IA accélère[^<.\n]{0,40}", visible)
    mauvais = [s for s in slogans if not re.match(r"L['’]IA accélère, l['’]expérience pilote", s)]
    if not slogans:
        r("ALERTE", "Slogan absent (attendu près du CTA final)")
    else:
        r("ÉCHEC" if mauvais else "OK", f"Slogan : {'variante non conforme ' + str(mauvais) if mauvais else 'exact'}")
    nb_bv = len(re.findall(r"\bBig View\b", visible))
    r("OK" if nb_bv >= 2 else "ALERTE", f"« Big View » cité {nb_bv} fois dans le texte")

    # Structure
    h1 = re.findall(r"<h1\b", corps_sans_commentaires, re.I)
    r("ÉCHEC" if h1 else "OK", f"Balises <h1> dans le contenu : {len(h1)} (le titre WordPress est déjà le H1)")
    h2s = [texte(x) for x in re.findall(r"<h2[^>]*>(.*?)</h2>", corps, re.S | re.I)]
    r("OK" if 5 <= len(h2s) <= 10 else "ALERTE", f"Nombre de H2 : {len(h2s)} (attendu 5 à 10)")
    nb = mots(visible)
    r("OK" if 1600 <= nb <= 2600 else "ALERTE", f"Longueur : {nb} mots (cible 1 600 à 2 400)")
    figures = re.findall(r'<figure[^>]*>.*?</figure>', corps, re.S)
    r("OK" if len(figures) >= 4 else "ÉCHEC", f"Visuels dans l'article : {len(figures)} (minimum 4, hors image à la une)")
    sans_alt = [f for f in figures if not re.search(r'<img[^>]*alt="[^"]{15,}"', f)]
    if sans_alt:
        r("ÉCHEC", f"Visuels sans texte alternatif descriptif : {len(sans_alt)}")
    h2_sans_visuel = 0
    for sec in re.split(r"<h2[^>]*>", corps)[1:-1]:  # la dernière section (CTA) n'en a pas besoin
        if texte(sec.split("</h2>")[0]).lower().startswith("faq"):
            continue
        if "<figure" in sec or "bvc-table" in sec:
            h2_sans_visuel = 0
        else:
            h2_sans_visuel += 1
            if h2_sans_visuel >= 3:
                r("ALERTE", "Trois sections H2 d'affilée sans visuel ni tableau : la lecture devient un mur de texte")
                break
    if "data:image" in h:
        r("ÉCHEC", "Image en data URI : passer par la médiathèque")

    # Mot-clé principal
    r("OK" if contient(a.titre, kw) else "ÉCHEC", f"Mot-clé dans le titre WordPress (H1) : {contient(a.titre, kw)}")
    r("OK" if contient(a.titre_seo, kw) else "ÉCHEC", f"Mot-clé dans le titre SEO : {contient(a.titre_seo, kw)}")
    r("OK" if contient(a.meta, kw) else "ÉCHEC", f"Mot-clé dans la meta description : {contient(a.meta, kw)}")
    if norm(a.titre_seo).startswith(norm(kw)):
        r("OK", "Titre SEO : mot-clé en tête")
    else:
        r("ALERTE", "Titre SEO : mot-clé pas en tête")
    lead = re.search(r'<p class="bvc-lead"[^>]*>(.*?)</p>', corps, re.S)
    if not lead:
        paras = [p for p in re.findall(r"<p[^>]*>(.*?)</p>", corps, re.S) if "Florent Buil" not in p]
        lead_txt = texte(paras[0]) if paras else ""
    else:
        lead_txt = texte(lead.group(1))
    r("OK" if contient(lead_txt, kw) else "ÉCHEC", f"Mot-clé dans le premier paragraphe : {contient(lead_txt, kw)}")
    h2_kw = [x for x in h2s if contient(x, kw)]
    r("OK" if h2_kw else "ÉCHEC", f"Mot-clé dans au moins un H2 : {len(h2_kw)}")
    occ = norm(visible).count(norm(kw))
    r("OK" if occ <= 8 else "ALERTE", f"Occurrences exactes du mot-clé : {occ} (au-delà de 8, risque de sur-optimisation)")
    for s in [x.strip() for x in a.secondaires.split(",") if x.strip()]:
        r("OK" if contient(visible, s) else "ALERTE", f"Mot-clé secondaire « {s} » présent : {contient(visible, s)}")

    # Yoast
    lt, lm = len(a.titre_seo), len(a.meta)
    r("OK" if lt <= 60 else "ÉCHEC", f"Titre SEO : {lt} caractères (max 60)")
    r("OK" if 120 <= lm <= 155 else "ÉCHEC", f"Meta description : {lm} caractères (120 à 155)")

    # Réponses directes
    sections = re.split(r"<h2[^>]*>", corps)[1:]
    sans_reponse = []
    for i, sec in enumerate(sections):
        titre_h2 = texte(sec.split("</h2>")[0])
        if titre_h2.lower().startswith("faq"):
            continue
        m = re.search(r'</h2>\s*<p class="bvc-answer"[^>]*>(.*?)</p>', sec, re.S)
        if not m:
            sans_reponse.append(titre_h2)
            continue
        n = mots(texte(m.group(1)))
        if not 40 <= n <= 60:
            r("ALERTE", f"Réponse directe de {n} mots sous « {titre_h2[:60]} » (cible 40 à 60)")
        if "<a " in m.group(1):
            r("ALERTE", f"Lien dans la réponse directe sous « {titre_h2[:60]} »")
    r("ÉCHEC" if sans_reponse else "OK", f"H2 sans réponse directe juste en dessous : {sans_reponse or 0}")

    # FAQ
    questions = [texte(q) for q in re.findall(r"<summary[^>]*>(.*?)</summary>", corps, re.S)]
    r("OK" if 6 <= len(questions) <= 9 else "ALERTE", f"FAQ : {len(questions)} questions (cible 6 à 8)")
    if not any("pourquoi choisir big view" in q.lower() for q in questions):
        r("ÉCHEC", "FAQ : question « Pourquoi choisir Big View comme agence … à … ? » absente")

    # JSON-LD
    types, faq_ld = [], []
    for bloc in re.findall(r'<script type="application/ld\+json">(.*?)</script>', h, re.S):
        try:
            d = json.loads(bloc)
        except json.JSONDecodeError as e:
            r("ÉCHEC", f"JSON-LD invalide : {e}")
            continue
        types.append(d.get("@type"))
        if d.get("@type") == "FAQPage":
            faq_ld = [q.get("name", "") for q in d.get("mainEntity", [])]
        if d.get("@type") in ("Article", "BlogPosting"):
            manque = [k for k in ("author", "datePublished", "dateModified", "headline") if k not in d]
            if manque:
                r("ÉCHEC", f"JSON-LD Article : champs manquants {manque}")
        if "{{" in bloc:
            r("ÉCHEC", "JSON-LD : un champ du gabarit n'a pas été rempli")
        if d.get("@type") == "BreadcrumbList" and not a.hors_ligne:
            items = d.get("itemListElement", [])
            for it in items[1:-1]:  # le dernier niveau est l'article, pas encore publié
                u = it.get("item", "")
                code = subprocess.run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "20", u],
                                      capture_output=True, text=True).stdout
                if code != "200":
                    r("ÉCHEC", f"Fil d'Ariane : {u} répond {code} (utiliser l'URL finale, sans redirection)")
    for t in ("Article", "FAQPage", "BreadcrumbList"):
        if t not in types and not (t == "Article" and "BlogPosting" in types):
            r("ÉCHEC", f"JSON-LD {t} absent")
    if faq_ld and [norm(x) for x in faq_ld] != [norm(x) for x in questions]:
        r("ÉCHEC", "FAQPage JSON-LD différent de la FAQ visible (mêmes questions, même ordre)")
    if "{{" in corps:
        r("ÉCHEC", "Champs du gabarit non remplis ({{…}}) dans le contenu")

    # Liens
    liens = re.findall(r'<a\s[^>]*href="([^"]+)"[^>]*>(.*?)</a>', corps, re.S)
    internes = [(u, texte(t)) for u, t in liens if u.startswith("https://big-view.fr/")]
    services, blog = [], []
    for u, t in internes:
        chemin = u.replace("https://big-view.fr/", "").split("?")[0].split("#")[0]
        seg = chemin.split("/")[0]
        if seg == "contact" or not chemin:
            continue
        (blog if seg in CATEGORIES_BLOG and chemin.count("/") >= 2 else services).append(u)
    r("OK" if 3 <= len(set(services)) <= 8 else "ÉCHEC", f"Liens vers pages services ou ville : {len(set(services))} (cible 3 à 6)")
    r("OK" if len(set(blog)) >= 2 else "ÉCHEC", f"Liens vers d'autres articles du blog : {len(set(blog))} (min 2)")
    for u, t in liens:
        if texte(t).lower().strip(" .") in ANCRES_INTERDITES:
            r("ÉCHEC", f"Ancre interdite « {texte(t)} » vers {u}")
    ancres = [t.lower() for _, t in internes]
    doublons = {x for x in ancres if ancres.count(x) > 1}
    if doublons:
        r("ALERTE", f"Ancres répétées : {sorted(doublons)}")
    if not any("contact/?source=" in u for u, _ in liens):
        r("ALERTE", "CTA vers https://big-view.fr/contact/?source=[slug] absent")

    if not a.hors_ligne:
        for u in sorted(set(services + blog)):
            code = subprocess.run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "20", u],
                                  capture_output=True, text=True).stdout
            if code != "200":
                r("ÉCHEC", f"Lien interne {u} répond {code} (attendu 200, sans redirection)")

    # Style
    bas = visible.lower()
    trouves = [m for m in INTENSIFS if m in bas]
    if trouves:
        r("ALERTE", f"Formules à éviter : {trouves}")

    ordre = {"ÉCHEC": 0, "ALERTE": 1, "OK": 2}
    for niveau, msg in sorted(resultats, key=lambda x: ordre[x[0]]):
        print(f"{niveau:7} {msg}")
    n_e = sum(1 for n, _ in resultats if n == "ÉCHEC")
    n_a = sum(1 for n, _ in resultats if n == "ALERTE")
    print(f"\nBilan : {n_e} échec(s), {n_a} alerte(s).")
    sys.exit(1 if n_e else 0)


if __name__ == "__main__":
    main()
