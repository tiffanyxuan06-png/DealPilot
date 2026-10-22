"""Product knowledge engine: consultative recommendations, model comparisons,
and quote pricing previews based strictly on catalog specs and database pricing."""

from typing import Any, Dict, List, Optional


def _get(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        if key in obj:
            return obj[key]
        if key == "sell_price" and "sellPrice" in obj:
            return obj["sellPrice"]
        if key == "sellPrice" and "sell_price" in obj:
            return obj["sell_price"]
        return default
    return getattr(obj, key, default)


def _get_spec(prod: Any, key: str, default: Any = None) -> Any:
    specs = _get(prod, "specs", {})
    if isinstance(specs, dict):
        return specs.get(key, default)
    return default


def recommend(needs: Dict[str, Any], products: List[Any]) -> List[Any]:
    """Recommend 1-3 catalog products based on extracted customer needs.
    Rule-of-thumb for air conditioning:
    <= 150 sqft -> 1.0 HP
    151-250 sqft -> 1.5 HP
    251-400 sqft -> 2.0 HP
    """
    airconds = [p for p in products if _get_spec(p, "category") == "aircond" or "ACN-" in str(_get(p, "sku", ""))]
    if not airconds:
        airconds = [p for p in products if str(_get(p, "sku", "")) != "SVC-INSTALL"]
    if not airconds:
        return products[:2]

    target_hp = needs.get("hp")
    room_sqft = needs.get("room_sqft")
    preferred_brand = (needs.get("brand") or "").lower()

    if target_hp is None and room_sqft:
        try:
            sqft = float(room_sqft)
            if sqft <= 150:
                target_hp = 1.0
            elif sqft <= 250:
                target_hp = 1.5
            else:
                target_hp = 2.0
        except (ValueError, TypeError):
            target_hp = None

    scored = []
    for p in airconds:
        score = 0
        hp = _get_spec(p, "hp")
        brand = (_get_spec(p, "brand") or "").lower()

        # HP match
        if target_hp is not None and hp is not None:
            if abs(float(hp) - float(target_hp)) < 0.1:
                score += 50
            elif abs(float(hp) - float(target_hp)) <= 0.5:
                score += 20
        elif room_sqft:
            sqft_range = _get_spec(p, "room_sqft")
            if isinstance(sqft_range, list) and len(sqft_range) == 2:
                if sqft_range[0] <= float(room_sqft) <= sqft_range[1]:
                    score += 45

        # Brand preference match
        if preferred_brand and preferred_brand in brand:
            score += 30

        scored.append((score, p))

    scored.sort(key=lambda x: (x[0], -int(_get(x[1], "sell_price", 0) or 0)), reverse=True)
    return [p for _, p in scored[:3]]


def compare(skus: List[str], products: List[Any]) -> Dict[str, Any]:
    """Build a side-by-side comparison matrix for given SKUs or top alternatives."""
    sku_map = {_get(p, "sku", ""): p for p in products}
    matched = [sku_map[s] for s in skus if s in sku_map]

    if len(matched) < 2:
        if len(matched) == 1:
            base = matched[0]
            base_hp = _get_spec(base, "hp")
            base_sku = _get(base, "sku", "")
            alts = [
                p for p in products
                if _get(p, "sku", "") != base_sku
                and _get_spec(p, "category") == "aircond"
                and _get_spec(p, "hp") == base_hp
            ]
            if alts:
                matched.append(alts[0])
            else:
                other_ac = [p for p in products if _get(p, "sku", "") != base_sku and _get_spec(p, "category") == "aircond"]
                if other_ac:
                    matched.append(other_ac[0])
        else:
            ac_list = [p for p in products if _get_spec(p, "category") == "aircond"]
            matched = ac_list[:2] if len(ac_list) >= 2 else products[:2]

    headers = ["Model", "Price", "HP", "Coverage", "Energy Rating", "Warranty", "Best For"]
    rows = []
    for p in matched:
        hp = _get_spec(p, "hp")
        hp_str = f"{hp} HP" if hp else "N/A"
        sqft = _get_spec(p, "room_sqft")
        coverage = f"{sqft[0]}-{sqft[1]} sqft" if isinstance(sqft, list) and len(sqft) == 2 else "Standard"
        rows.append({
            "sku": _get(p, "sku", ""),
            "name": _get(p, "name", ""),
            "price": f"RM {int(_get(p, 'sell_price', 0) or 0):,}",
            "hp": hp_str,
            "coverage": coverage,
            "energy": _get_spec(p, "energy", "-"),
            "warranty": _get_spec(p, "warranty", "-"),
            "best_for": _get_spec(p, "best_for", "-"),
        })

    return {
        "headers": headers,
        "rows": rows,
        "skus": [_get(p, "sku", "") for p in matched],
    }


def upsell(current_items: List[Dict[str, Any]], products: List[Any]) -> List[Any]:
    """Find relevant catalog add-ons (installation, piping, gas) not yet in the quote."""
    current_skus = {item.get("sku") for item in current_items if isinstance(item, dict)}
    candidates = []
    sku_map = {_get(p, "sku", ""): p for p in products}

    priority_skus = ["SVC-INSTALL", "PIP-COP-3M", "GAS-R32"]
    for s in priority_skus:
        if s in sku_map and s not in current_skus:
            candidates.append(sku_map[s])

    return candidates


def calculate_quote_preview(
    items: List[Dict[str, Any]],
    include_install: bool,
    products: List[Any],
    framework: str = "",
) -> Dict[str, Any]:
    """Compute line items, subtotal, installation, and deposit for quote preview."""
    sku_map = {_get(p, "sku", ""): p for p in products}

    preview_items = []
    subtotal = 0
    total_ac_qty = 0

    for it in items:
        sku = it.get("sku")
        qty = int(it.get("qty", 1) or 1)
        prod = sku_map.get(sku)
        if prod:
            unit_price = int(_get(prod, "sell_price", 0) or 0)
            name = _get(prod, "name", sku)
            if _get_spec(prod, "category") == "aircond" or "ACN-" in str(sku):
                total_ac_qty += qty
        else:
            unit_price = int(it.get("price") or it.get("sell_price") or it.get("sellPrice") or 0)
            name = it.get("name", sku or "Custom Item")

        line_total = unit_price * qty
        subtotal += line_total
        preview_items.append({
            "sku": sku,
            "name": name,
            "qty": qty,
            "unitPrice": unit_price,
            "lineTotal": line_total,
        })

    has_install_item = any(it.get("sku") == "SVC-INSTALL" for it in preview_items)
    if include_install and not has_install_item and total_ac_qty > 0:
        install_prod = sku_map.get("SVC-INSTALL")
        install_rate = int(_get(install_prod, "sell_price", 250) or 250) if install_prod else 250
        install_name = _get(install_prod, "name", "Standard Installation Labor") if install_prod else "Standard Installation Labor"
        install_qty = total_ac_qty
        install_total = install_rate * install_qty
        subtotal += install_total
        preview_items.append({
            "sku": "SVC-INSTALL",
            "name": install_name,
            "qty": install_qty,
            "unitPrice": install_rate,
            "lineTotal": install_total,
            "isService": True,
        })

    deposit_pct = 40
    deposit_rm = int(round(subtotal * (deposit_pct / 100.0)))
    balance_rm = subtotal - deposit_rm

    return {
        "items": preview_items,
        "subtotal": subtotal,
        "discount": 0,
        "total": subtotal,
        "depositPct": deposit_pct,
        "depositRm": deposit_rm,
        "balanceRm": balance_rm,
        "includeInstall": include_install,
    }
