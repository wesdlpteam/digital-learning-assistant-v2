"""One-off audit of DLA suggestion cards: tool/description mismatch + over-suggestion + age band."""
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data.json"

APPROVED_TOOLS = [
    "3D Printers", "Adobe Express", "Animating a Character with Adobe Express", "Beebots",
    "Book Creator", "Brushes Redux", "Canva", "ChatterPix Kids", "Clickview", "Delightex", "Epic",
    "Explain Everything", "Field Guide to Victoria", "Freeform", "GarageBand", "Geoboard",
    "Google Maps", "iMovie", "insta360 camera", "iPad", "Kahoot", "Lego Spike Prime", "Makey Makey",
    "Merge Cubes", "Micro:bit", "Microsoft Excel", "Microsoft Forms", "Microsoft Word",
    "Minecraft Education", "National Geographic MapMaker", "Padlet", "PicCollage",
    "Podcast Equipment", "Podcasting using Canva", "Puppet Pals", "ScratchJr", "Seesaw",
    "Sketchbook", "Sky Map", "Sphero BOLT", "Sphero Indi", "Stop Motion Studio", "Tinkercad",
    "Wise Discussion Chatbots", "Word Clouds ABCya",
]

BANNED_TOOLS = [
    "Apple Keynote", "Banqer", "ClassVR", "Digital Cameras", "Google Earth", "Google Suite",
    "Green Screen", "Lego Spike Essential", "Microsoft OneNote", "Microsoft PowerPoint",
    "Microsoft Sway", "Microsoft Teams", "WeVideo",
]

AGE_RANGES = {
    "Microsoft Word": (4, 6), "Microsoft Excel": (0, 6), "Microsoft Forms": (0, 6),
    "Beebots": (0, 2), "Sphero Indi": (0, 2), "Sphero BOLT": (3, 6), "Lego Spike Prime": (4, 6),
    "Micro:bit": (3, 6), "Makey Makey": (0, 6), "3D Printers": (5, 6), "Merge Cubes": (0, 6),
    "Podcast Equipment": (2, 6), "iPad": (0, 6), "Seesaw": (0, 4), "Canva": (3, 6),
    "Book Creator": (2, 6), "Padlet": (3, 6), "GarageBand": (0, 6), "ScratchJr": (0, 2),
    "Stop Motion Studio": (3, 6), "ChatterPix Kids": (0, 2), "iMovie": (0, 6), "Puppet Pals": (0, 2),
    "Adobe Express": (3, 6), "Podcasting using Canva": (2, 6), "Google Maps": (0, 6),
    "Field Guide to Victoria": (0, 6), "Sky Map": (0, 6), "Geoboard": (0, 6), "Clickview": (0, 6),
    "Epic": (0, 6), "PicCollage": (0, 6), "Brushes Redux": (0, 6), "Word Clouds ABCya": (0, 6),
    "Sketchbook": (0, 6), "Explain Everything": (3, 6), "Freeform": (0, 6), "Delightex": (0, 6),
    "Kahoot": (3, 6), "Tinkercad": (4, 6), "Minecraft Education": (2, 6),
    "Wise Discussion Chatbots": (3, 6), "National Geographic MapMaker": (3, 6),
    "Animating a Character with Adobe Express": (0, 6), "insta360 camera": (0, 6),
}

TOOL_URL_HINTS = {
    "Seesaw": ["seesaw.me", "web.seesaw.me", "app.seesaw.me", "seesaw.com"],
    "Minecraft Education": ["education.minecraft.net", "minecraft.net/en-us/lessons",
                            "minecraft.net/lessons", "aka.ms/minecraft"],
    "Micro:bit": ["microbit.org"],
    "Adobe Express": ["adobe.com/express", "express.adobe.com", "adobesparkpost.app.link",
                      "new.express.adobe.com"],
    "Animating a Character with Adobe Express": ["adobe.com/express", "express.adobe.com"],
    "Sphero BOLT": ["sphero.com", "edu.sphero.com"],
    "Sphero Indi": ["sphero.com", "edu.sphero.com"],
    "Book Creator": ["bookcreator.com"],
    "ScratchJr": ["scratchjr.org"],
    "Tinkercad": ["tinkercad.com"],
    "Canva": ["canva.com"],
    "Clickview": ["clickview.com.au", "clickview.net", "clickview.co"],
    "Kahoot": ["kahoot.com", "kahoot.it", "create.kahoot.it"],
    "Padlet": ["padlet.com"],
    "Lego Spike Prime": ["education.lego.com/en-us/products/lego-education-spike-prime",
                         "education.lego.com/en-us/lessons"],
    "Stop Motion Studio": ["stopmotionstudio.com", "cateater.com"],
    "iMovie": ["apple.com/imovie", "support.apple.com/imovie"],
    "GarageBand": ["apple.com/garageband", "support.apple.com/garageband"],
    "National Geographic MapMaker": ["mapmaker.nationalgeographic.org",
                                     "mapmaker.geo.nationalgeographic"],
    "Google Maps": ["google.com/maps", "maps.google.com", "maps.app.goo.gl"],
    "Field Guide to Victoria": ["fieldguide.museum.vic.gov.au"],
    "Merge Cubes": ["mergeedu.com", "miniverse.io"],
    "Delightex": ["delightex.com", "cospaces.io"],
    "Explain Everything": ["explaineverything.com"],
    "Epic": ["getepic.com"],
    "PicCollage": ["pic-collage.com", "piccollage.com"],
    "Brushes Redux": ["brushesapp.com"],
    "Sketchbook": ["sketchbook.com"],
    "Geoboard": ["mathlearningcenter.org/apps/geoboard"],
    "ChatterPix Kids": ["duckduckmoose.com"],
    "Word Clouds ABCya": ["abcya.com/word_clouds", "abcya.com/games/word_clouds"],
    "Beebots": ["tts-group.co.uk", "bee-bot"],
    "Microsoft Word": ["word.office.com", "office.com/word"],
    "Microsoft Excel": ["excel.office.com", "office.com/excel"],
    "Microsoft Forms": ["forms.office.com", "forms.microsoft.com"],
    "Freeform": ["apple.com/freeform", "support.apple.com/freeform"],
    "Puppet Pals": ["polishedplay.com"],
}

BANNED_URL_HINTS = {
    "Apple Keynote": ["apple.com/keynote", "support.apple.com/keynote"],
    "Banqer": ["banqer.com"],
    "ClassVR": ["classvr.com"],
    "Google Earth": ["earth.google.com", "google.com/earth"],
    "Google Suite": ["docs.google.com", "slides.google.com", "drive.google.com",
                     "sheets.google.com"],
    "Lego Spike Essential": ["education.lego.com/en-us/products/lego-education-spike-essential"],
    "Microsoft OneNote": ["onenote.office.com", "onenote.com"],
    "Microsoft PowerPoint": ["powerpoint.office.com", "office.com/powerpoint"],
    "Microsoft Sway": ["sway.office.com", "sway.com"],
    "Microsoft Teams": ["teams.microsoft.com", "teams.live.com"],
    "WeVideo": ["wevideo.com"],
}

YL_TO_NUM = {
    "Prep": 0, "Foundation": 0,
    "Year 1": 1, "Year 2": 2, "Year 3": 3, "Year 4": 4, "Year 5": 5, "Year 6": 6,
    "ECLC": None, "3YO": None, "4YO": None,
}

TOOL_FAMILY = {
    "Animating a Character with Adobe Express": "Adobe Express",
}


def family_of(name):
    return TOOL_FAMILY.get(name, name)


def make_name_regex(name):
    return re.compile(r"(?<![A-Za-z0-9])" + re.escape(name) + r"(?![A-Za-z0-9])", re.IGNORECASE)


NAME_REGEXES = {t: make_name_regex(t) for t in APPROVED_TOOLS + BANNED_TOOLS}


def url_hosts_in(text, hints_by_tool):
    matches = []
    low = text.lower()
    seen = set()
    for tool, hints in hints_by_tool.items():
        for h in hints:
            idx = low.find(h)
            if idx == -1:
                continue
            start = low.rfind("http", 0, idx)
            if start == -1:
                start = max(0, idx - 25)
            end = idx + len(h)
            while end < len(text) and text[end] not in ' \n\t\r)"\'<>]':
                end += 1
            evidence = text[start:end]
            key = (tool, evidence)
            if key in seen:
                continue
            seen.add(key)
            matches.append((tool, evidence))
            break
    return matches


def audit():
    data = json.loads(DATA.read_text(encoding="utf-8"))
    findings = []
    total_suggestions = 0
    per_group = defaultdict(lambda: defaultdict(int))
    per_group_sample = {}
    unknown_yls = Counter()
    unknown_tools = Counter()
    empty_suggestions = 0

    for entry in data:
        ca = entry.get("ca", "")
        yl = entry.get("yl", "")
        th = entry.get("th", "")
        if yl not in YL_TO_NUM:
            unknown_yls[yl] += 1
        for s in entry.get("s", []) or []:
            t = (s.get("t") or "").strip()
            d = (s.get("d") or "")
            if not t or not d:
                empty_suggestions += 1
                continue
            total_suggestions += 1
            t_fam = family_of(t)
            if t not in APPROVED_TOOLS and t not in BANNED_TOOLS:
                unknown_tools[t] += 1

            per_group[(ca, yl)][t_fam] += 1
            per_group_sample.setdefault((ca, yl, t_fam), th)

            # 1. URL_MISMATCH
            for url_tool, url_evidence in url_hosts_in(d, TOOL_URL_HINTS):
                if family_of(url_tool) != t_fam:
                    findings.append({
                        "check": "URL_MISMATCH", "severity": "HIGH",
                        "ca": ca, "yl": yl, "th": th,
                        "label_tool": t, "implicated_tool": url_tool,
                        "url_evidence": url_evidence,
                        "description_excerpt": d[:240],
                    })

            # 2. BANNED_URL
            for ban_tool, url_evidence in url_hosts_in(d, BANNED_URL_HINTS):
                findings.append({
                    "check": "BANNED_URL", "severity": "HIGH",
                    "ca": ca, "yl": yl, "th": th,
                    "label_tool": t, "implicated_tool": ban_tool,
                    "url_evidence": url_evidence,
                    "description_excerpt": d[:240],
                })

            # 3. NAME_MISMATCH
            label_rx = NAME_REGEXES.get(t)
            label_count = len(label_rx.findall(d)) if label_rx else 0
            if t_fam != t:
                fam_rx = NAME_REGEXES.get(t_fam)
                if fam_rx:
                    label_count += len(fam_rx.findall(d))
            if label_count == 0:
                other_hits = []
                for other in APPROVED_TOOLS:
                    if family_of(other) == t_fam:
                        continue
                    rx = NAME_REGEXES[other]
                    n = len(rx.findall(d))
                    if n >= 2:
                        other_hits.append((other, n))
                if other_hits:
                    other_hits.sort(key=lambda x: -x[1])
                    findings.append({
                        "check": "NAME_MISMATCH", "severity": "MEDIUM",
                        "ca": ca, "yl": yl, "th": th,
                        "label_tool": t, "implicated_tool": other_hits[0][0],
                        "other_mentions": other_hits[0][1],
                        "description_excerpt": d[:240],
                    })

            # 4. AGE_BAND
            yn = YL_TO_NUM.get(yl, "unknown")
            if yn != "unknown" and yn is not None and t in AGE_RANGES:
                lo_, hi_ = AGE_RANGES[t]
                if yn < lo_ or yn > hi_:
                    findings.append({
                        "check": "AGE_BAND", "severity": "MEDIUM",
                        "ca": ca, "yl": yl, "th": th,
                        "label_tool": t,
                        "allowed_range": f"{lo_}-{hi_}",
                        "actual_year": yn,
                        "description_excerpt": d[:240],
                    })

            # 5. BANNED_TOOL
            if t in BANNED_TOOLS:
                findings.append({
                    "check": "BANNED_TOOL", "severity": "HIGH",
                    "ca": ca, "yl": yl, "th": th,
                    "label_tool": t,
                    "description_excerpt": d[:240],
                })

    # 6. OVER_SUGGEST
    for (ca, yl), tools in per_group.items():
        total = sum(tools.values())
        if total == 0:
            continue
        for t, c in tools.items():
            share = c / total
            if c >= 4 and share > 0.25:
                findings.append({
                    "check": "OVER_SUGGEST", "severity": "LOW",
                    "ca": ca, "yl": yl,
                    "th_example": per_group_sample.get((ca, yl, t), ""),
                    "label_tool": t, "count": c, "group_total": total,
                    "share_pct": round(share * 100, 1),
                })

    sev_counts = Counter(f["severity"] for f in findings)
    check_counts = Counter(f["check"] for f in findings)
    group_counts = {}
    for (ca, yl), tools in per_group.items():
        total = sum(tools.values())
        flagged = sum(1 for f in findings
                      if f.get("ca") == ca and f.get("yl") == yl
                      and f["check"] != "OVER_SUGGEST")
        group_counts[f"{ca}|{yl}"] = {"suggestions": total, "flagged": flagged}

    summary = {
        "total_entries": len(data),
        "total_suggestions": total_suggestions,
        "empty_suggestions_skipped": empty_suggestions,
        "counts_by_check": dict(check_counts),
        "counts_by_severity": dict(sev_counts),
        "counts_by_campus_year": group_counts,
        "unknown_year_labels": dict(unknown_yls),
        "unknown_tool_labels_count": len(unknown_tools),
        "top_unknown_tool_labels": unknown_tools.most_common(20),
    }

    (ROOT / "audit_findings.json").write_text(
        json.dumps({"summary": summary, "findings": findings}, indent=2), encoding="utf-8"
    )

    md = []
    md.append("# DLA suggestion audit\n\n")
    md.append(f"**{total_suggestions} cards audited across {len(data)} units.**  \n")
    md.append(f"**{len(findings)} problems flagged** — {sev_counts.get('HIGH', 0)} high, "
              f"{sev_counts.get('MEDIUM', 0)} medium, {sev_counts.get('LOW', 0)} low.\n\n")
    if empty_suggestions:
        md.append(f"_(Skipped {empty_suggestions} cards that had no tool name or no description.)_\n\n")
    md.append("**Breakdown by check:**\n")
    for ck, n in check_counts.most_common():
        md.append(f"- **{ck}**: {n}\n")
    md.append("\n")
    if unknown_yls:
        md.append(f"_Unknown year-level labels encountered: {dict(unknown_yls)}_\n\n")
    if unknown_tools:
        md.append(f"_Tools used in `t` that aren't in the approved or banned list "
                  f"({len(unknown_tools)} distinct, top: "
                  f"{', '.join(name for name, _ in unknown_tools.most_common(5))}). "
                  f"These were treated as 'no known age band' for the age check._\n\n")
    md.append("---\n\n")

    explanations = {
        "URL_MISMATCH": "The card is labelled as one tool, but the description contains a link to a different tool's website.",
        "BANNED_URL": "The description links to a tool that is on the banned list.",
        "NAME_MISMATCH": "The description never names the labelled tool and instead names a different tool two or more times.",
        "AGE_BAND": "The labelled tool sits outside its approved year-level range for the unit it appears in.",
        "BANNED_TOOL": "The card itself recommends a tool on the banned list.",
        "OVER_SUGGEST": "Within a single campus + year, one tool is appearing in more than 25% of the cards (and at least four times).",
    }

    for sev in ["HIGH", "MEDIUM", "LOW"]:
        sev_findings = [f for f in findings if f["severity"] == sev]
        if not sev_findings:
            continue
        md.append(f"## {sev} severity ({len(sev_findings)} cards)\n\n")
        by_check = defaultdict(list)
        for f in sev_findings:
            by_check[f["check"]].append(f)
        for ck, items in by_check.items():
            md.append(f"### {ck} — {len(items)} cards\n\n")
            md.append(explanations.get(ck, "") + "\n\n")
            limit = 100
            for f in items[:limit]:
                if ck == "OVER_SUGGEST":
                    md.append(f"- **{f['ca']} / {f['yl']}** — {f['label_tool']}: "
                              f"{f['count']} cards out of {f['group_total']} ({f['share_pct']}%). "
                              f"Example unit: \"{f['th_example']}\"\n")
                elif ck == "AGE_BAND":
                    md.append(f"- **{f['ca']} / {f['yl']}** — \"{f['th']}\" — labelled "
                              f"**{f['label_tool']}** (approved Year {f['allowed_range']}).\n")
                else:
                    extra = ""
                    if "url_evidence" in f:
                        extra = f"  \n  Link in description: `{f['url_evidence']}`"
                    elif "other_mentions" in f:
                        extra = f"  \n  Description names **{f['implicated_tool']}** {f['other_mentions']} times."
                    impl = f.get("implicated_tool", "")
                    impl_part = f" — looks like a **{impl}** lesson" if impl else ""
                    md.append(f"- **{f['ca']} / {f['yl']}** — \"{f['th']}\" — labelled "
                              f"**{f['label_tool']}**{impl_part}.{extra}  \n"
                              f"  Excerpt: _{f['description_excerpt']}_\n")
            if len(items) > limit:
                md.append(f"\n_…{len(items) - limit} more in `audit_findings.json`._\n")
            md.append("\n")

    (ROOT / "audit_findings.md").write_text("".join(md), encoding="utf-8")

    print(f"{total_suggestions} suggestions audited, {len(findings)} findings: "
          f"{sev_counts.get('HIGH', 0)} HIGH, {sev_counts.get('MEDIUM', 0)} MEDIUM, "
          f"{sev_counts.get('LOW', 0)} LOW")
    print("Per check:", dict(check_counts))
    if unknown_yls:
        print("Unknown yl labels:", dict(unknown_yls))
    if unknown_tools:
        print(f"Unknown tool labels: {len(unknown_tools)} distinct "
              f"(top: {[n for n, _ in unknown_tools.most_common(5)]})")


if __name__ == "__main__":
    audit()
