"""Match what a customer wrote to lines on the business's own price list (no product names in code)."""
import re
from typing import Any, Dict, List, Optional


def _as_dict(p: Any) -> Dict[str, Any]:
    if isinstance(p, dict):
        return p
    return {"sku": getattr(p, "sku", ""), "name": getattr(p, "name", ""), "sellPrice": getattr(p, "sell_price", 0),
            "specs": getattr(p, "specs", {}) or {}}


def brands_in_text(text: str, products: List[Any]) -> List[str]:
    """Brands from the price list (specs.brand) that the text mentions, in price-list order."""
    found: List[str] = []
    text = text.lower()
    for p in map(_as_dict, products):
        brand = str((p.get("specs") or {}).get("brand") or "")
        for b in re.split(r"[/,]", brand):
            b = b.strip()
            if b and b.lower() not in ("universal",) and re.search(rf"\b{re.escape(b.lower())}\b", text) and b not in found:
                found.append(b)
    return found


_NAME_STOPWORDS = {"unit", "units", "set", "sets", "box", "pack", "carton", "with", "and", "the", "for", "item", "series", "standard"}
_QTY_WORDS = r"(?:units?|x|sets?|pcs|bottles?|tanks?|cartons?|seats?|boxes?|packs?|biji|buah|tong)"


def _name_tokens(text: str) -> List[str]:
    """Lowercase words, keeping model sizes whole ("1.5hp", "r32", "3kg") and writing HP the same way ("1.0 HP" -> "1hp")."""
    text = re.sub(r"(\d+(?:\.\d+)?)\s*(?:hp|horse\s*power|kuda)\b", lambda m: f"{float(m.group(1)):g}hp", text.lower())
    return re.findall(r"[a-z0-9]+(?:\.\d+)?[a-z]*", text)


def _best_product(segment_tokens: List[str], products: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The one product this part of the message names best. A different HP rules a product out, so
    "Daikin 1.5HP" is the Daikin 1.5HP only, not every Daikin and every 1.5HP unit."""
    seg = set(segment_tokens)
    seg_hp = {t for t in seg if t.endswith("hp")}
    best, best_score = None, 0
    for p in products:
        if p["sku"].lower() in seg:
            return p
        tokens = [t for t in _name_tokens(p["name"]) if len(t) >= 2 and t not in _NAME_STOPWORDS]
        hp = {t for t in tokens if t.endswith("hp")}
        if seg_hp and hp and not (seg_hp & hp):
            continue
        score = sum(1 for t in tokens if t in seg and not t.endswith("hp")) + (2 if hp & seg_hp else 0)
        if score > best_score:
            best, best_score = p, score
    return best


def match_price_list_lines(msg_lower: str, products: List[Any], allow_unquantified: bool = True) -> List[Dict[str, Any]]:
    """Price-list lines the customer asked for: each "<qty> <product words>" part of the message picks one product.

    Everything comes from the price list (names, SKUs, prices), so a new business's products match with no code change.
    With allow_unquantified, a product named without a number counts as 1 unit."""
    products = [_as_dict(p) for p in products]
    msg_lower = msg_lower.lower()
    lines: List[Dict[str, Any]] = []
    # A quantity is a whole number that is not part of a size like "1.5hp" or "r32"
    qty_re = re.compile(rf"(?<![\w.])(\d+)(?![\d.])\s*{_QTY_WORDS}?\s+(?=[a-z])")
    starts = list(qty_re.finditer(msg_lower))
    segments = [(int(m.group(1)), msg_lower[m.end():(starts[i + 1].start() if i + 1 < len(starts) else len(msg_lower))])
                for i, m in enumerate(starts)]
    for qty, text in segments:
        p = _best_product(_name_tokens(text), products) if qty > 0 else None
        if not p:
            continue
        existing = next((ln for ln in lines if ln["item"]["sku"] == p["sku"]), None)
        if existing:
            existing["qty"] = qty
        else:
            lines.append({"item": p, "qty": qty, "price": p.get("sellPrice", p.get("sell_price", 100))})
    if not lines and allow_unquantified:
        p = _best_product(_name_tokens(msg_lower), products)
        if p:
            lines.append({"item": p, "qty": 1, "price": p.get("sellPrice", p.get("sell_price", 100))})
    return lines
