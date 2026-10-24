import csv
import io
import re
import zipfile
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Header, HTTPException, Query, Request, Response

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.config import ROOT
from backend.db import orm, session_scope
from backend.models.enums import Role, Stage
from backend.services.business import load_business
from backend.services.customers import get_customer
from backend.services.permissions import OWNER_ONLY, normalize_role
from backend.services.pipeline import log

router = APIRouter(tags=["Exports"])

DISCLAIMER = "Subject to stock availability - prices valid 7 days from the quote date."

# Export A of docs/05_CSV_Accounting_Bridge_Spec.md, plus the deposit amount the customer said they paid.
CSV_COLUMNS = [
    "Order_ID", "Quotation_Ref", "Date", "Customer_Name", "Customer_Phone", "Customer_TIN",
    "Item_SKU", "Item_Description", "Quantity", "Unit_Price_MYR", "Discount_MYR", "Line_Total_MYR",
    "Payment_Deposit_Ref", "Payment_Deposit_Amount_MYR", "Sales_Rep", "Notes",
]


def _pdf_escape(text: str) -> str:
    """Escapes ASCII text for standard PDF content stream."""
    clean = text.encode("ascii", "ignore").decode("ascii")
    return clean.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_valid_pdf_bytes(lines: List[str]) -> bytes:
    """
    Builds a 100% standards-compliant, text-searchable PDF binary (using Type1 Helvetica)
    with embedded text streams so `pypdf` and any PDF viewer can read & decode it directly!
    """
    stream_cmds = ["BT", "/F1 11 Tf", "50 780 Td", "16 TL"]
    for idx, line in enumerate(lines):
        escaped = _pdf_escape(line)
        if idx == 0:
            stream_cmds.append(f"/F1 14 Tf ({escaped}) Tj /F1 10 Tf")
        else:
            stream_cmds.append(f"T* ({escaped}) Tj")
    stream_cmds.append("ET")
    stream_bytes = "\n".join(stream_cmds).encode("latin-1")

    objs: List[bytes] = [
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
        b"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
        f"5 0 obj\n<< /Length {len(stream_bytes)} >>\nstream\n".encode("latin-1")
        + stream_bytes
        + b"\nendstream\nendobj\n",
    ]

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for o in objs:
        offsets.append(len(out))
        out.extend(o)

    xref_pos = len(out)
    out.extend(f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode("latin-1"))
    for off in offsets:
        out.extend(f"{off:010d} 00000 n \n".encode("latin-1"))
    out.extend(
        f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode("latin-1")
    )
    return bytes(out)


def _money(v) -> str:
    return f"{v:.2f}"


def order_rows(session: Session, date_from: Optional[str] = None, date_to: Optional[str] = None) -> List[List[str]]:
    """Won orders, one line item per row. The deal's discount sits on its first line, so lines add up to the deal."""
    reps = {r.id: r.name for r in session.scalars(select(orm.Rep))}
    rows = []
    for d in session.scalars(select(orm.Deal).where(orm.Deal.stage == Stage.WON.value).order_by(orm.Deal.won_at, orm.Deal.id)):
        day = (d.won_at or "")[:10]
        if (date_from and day < date_from) or (date_to and day > date_to):
            continue
        cust = get_customer(session, d.customer)
        for n, item in enumerate(d.items):
            discount = d.discount if n == 0 else 0
            rows.append([
                d.order_no or "", d.id, day, d.customer, d.phone or "", (cust.tin if cust else "") or "",
                item["sku"], item["name"], str(item["qty"]), _money(item["unitPrice"]), _money(discount),
                _money(item["qty"] * item["unitPrice"] - discount),
                d.deposit_ref or "", _money(d.deposit_amount) if d.deposit_amount is not None else "",
                reps.get(d.rep_id, ""), (d.notes or "").replace("\n", " "),
            ])
    return rows


@router.get("/api/export/orders.csv", response_class=Response, responses={200: {"content": {"text/csv": {}}, "description": "Won orders, one row per line item"}})
def api_export_orders_csv(
    date_from: Optional[str] = Query(None, alias="from"),
    date_to: Optional[str] = Query(None, alias="to"),
    role: Optional[str] = Query(None),
    x_cashchase_role: Optional[str] = Header(None),
) -> Response:
    """Owner only: won orders for the accountant to import (AutoCount, SQL Account, Bukku or Excel)."""
    if normalize_role(role or x_cashchase_role) != Role.OWNER.value:
        raise HTTPException(status_code=403, detail=f"Only the Owner can do this: {OWNER_ONLY['export.csv']}.")
    for v in (date_from, date_to):
        if v:
            try:
                datetime.strptime(v, "%Y-%m-%d")
            except ValueError:
                raise HTTPException(status_code=400, detail="Dates must look like 2026-10-31.")
    with session_scope() as s:
        rows = order_rows(s, date_from, date_to)
        orders = len({r[0] for r in rows})
        log(s, f"[OWNER] Downloaded the won-orders CSV: {orders} order(s), {len(rows)} line(s)" + (f", {date_from or '…'} to {date_to or '…'}" if date_from or date_to else "") + ".")
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(CSV_COLUMNS)
    writer.writerows(rows)
    filename = f"Sales_Orders_{datetime.now().strftime('%Y%m%d')}.csv"
    return Response(
        content=buf.getvalue().encode("utf-8-sig"),  # the BOM makes Excel read the file as UTF-8
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/api/deals/{deal_id}/pdf", response_class=Response, responses={200: {"content": {"application/pdf": {}}, "description": "Quote or sales order PDF"}})
def api_deal_pdf(deal_id: str) -> Response:
    """Quote PDF (or sales order once won) with prices from the price list and the availability disclaimer."""
    return _generate_document_pdf(deal_id)


@router.get("/api/invoices/{invoice_id}/pdf", response_class=Response, responses={200: {"content": {"application/pdf": {}}, "description": "Quote or tax invoice PDF"}})
def api_invoice_pdf(invoice_id: str) -> Response:
    """Invoice or Quote PDF endpoint matching webapp /api/invoices/{id}/pdf requests."""
    return _generate_document_pdf(invoice_id)


def _generate_document_pdf(doc_id: str) -> Response:
    clean_id = doc_id.strip().replace("#", "")
    with session_scope() as s:
        d = s.get(orm.Deal, clean_id)
        if not d:
            d = s.scalars(
                select(orm.Deal).where(
                    (orm.Deal.order_no == clean_id) | (orm.Deal.id.like(f"%{clean_id}%"))
                )
            ).first()

        if not d:
            raise HTTPException(status_code=404, detail=f"Deal {doc_id} not found")

        biz = load_business(s)
        company = biz.company_name or "DealPilot Trading Sdn Bhd"
        rep = s.get(orm.Rep, d.rep_id) if d.rep_id is not None else None
        cust = get_customer(s, d.customer)

        won = d.stage == Stage.WON.value
        created = (d.created_at or "")[:10] or datetime.now().strftime("%Y-%m-%d")
        doc_type = "SALES ORDER" if won else "QUOTATION"
        doc_num = d.order_no if won else d.id

        lines = [
            f"{company} - {doc_type}",
            "======================================================================",
            f"Document No   : {doc_num}" + (f"  (quote {d.id})" if won else ""),
            f"Quote date    : {created}",
            f"Customer      : {d.customer} ({d.phone or '-'})",
            f"Buyer TIN     : {(cust.tin if cust else '') or '-'}",
            f"Sales rep     : {rep.name if rep else '-'}",
            "----------------------------------------------------------------------",
        ]

        for i in d.items:
            lines.append(f"  {i['qty']} x {i['name']} @ RM {i['unitPrice']:,}.00 = RM {i['qty'] * i['unitPrice']:,}.00")

        if d.discount:
            lines.append(f"  Discount: -RM {d.discount:,}.00")

        lines += [
            "----------------------------------------------------------------------",
            f"TOTAL         : RM {d.amount:,}.00",
            "======================================================================",
            "Payment: Maybank 5140-1234-5678 (DealPilot Trading) / DuitNow",
            DISCLAIMER,
        ]
        filename = f"{doc_num}_{d.customer.replace(' ', '_')}.pdf"
        return Response(
            content=build_valid_pdf_bytes(lines),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )


EXTENSION_DIR = ROOT / "extension"
REPLIT_HOSTS = (".replit.app", ".replit.dev", ".repl.co")


@router.get("/download/closiq-extension.zip", response_class=Response, include_in_schema=False)
@router.get(
    "/download/dealpilot-extension.zip",
    response_class=Response,
    responses={200: {"content": {"application/zip": {}}, "description": "The DealPilot Chrome extension, ready to load unpacked"}},
)
def download_extension(request: Request) -> Response:
    """The WhatsApp Web extension as a zip, built from extension/ on each request so it always matches this server.
    Downloaded from a Replit address, the extension's default server is set to that address (no typing needed)."""
    host = (request.headers.get("x-forwarded-host") or request.url.netloc).split(",")[0].strip().lower()
    hostname = host.split(":")[0]
    server = f"https://{host}" if hostname.endswith(REPLIT_HOSTS) else None
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(EXTENSION_DIR.rglob("*")):
            if not path.is_file() or path.name.startswith("."):
                continue
            data = path.read_bytes()
            if server and path.name == "content.js":
                data = re.sub(rb'const DEFAULT_BACKEND_URL = "[^"]*";',
                              f'const DEFAULT_BACKEND_URL = "{server}";'.encode(), data, count=1)
            zf.writestr(f"dealpilot-extension/{path.relative_to(EXTENSION_DIR).as_posix()}", data)
    return Response(
        content=buf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="dealpilot-extension.zip"'},
    )
