"""Chrome extension behaviour (docs/09 items 1 and 6), run in Node through test/unit/extension_harness.js."""
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

if shutil.which("node") is None:
    pytest.skip("node is not on PATH", allow_module_level=True)

ROOT = Path(__file__).resolve().parents[2]
HARNESS = ROOT / "test" / "unit" / "extension_harness.js"

SEND_EVENTS = {"click", "submit"}


def run_scenario(name, **opts):
    """Run one harness scenario and return its JSON: {scenario, result, network, events}."""
    cmd = ["node", str(HARNESS), name] + ([json.dumps(opts)] if opts else [])
    done = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert done.returncode == 0, done.stderr
    return json.loads(done.stdout)


def boot_calls(network):
    """(message type, path) of each boot call, with the backend host stripped."""
    return [(c.get("type"), (c.get("url") or "").replace("http://127.0.0.1:8000", "")) for c in network]


def posts(network, path):
    return [c for c in network if c.get("method") == "POST" and c.get("path") == path]


def sent_something(events):
    """True if the page clicked anything or pressed Enter (what a real send would need)."""
    return any(e["type"] in SEND_EVENTS or e.get("key") == "Enter" for e in events)


@pytest.mark.parametrize("script", ["content.js", "background.js"])
def test_extension_scripts_pass_syntax_check(script):
    done = subprocess.run(["node", "--check", str(ROOT / "extension" / script)], capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert done.returncode == 0, done.stderr


def test_insert_reply_fills_compose_box_without_sending():
    out = run_scenario("insert_reply")
    assert out["result"]["returned"] is True
    assert out["result"]["boxText"] == out["result"]["expected"]
    assert not sent_something(out["events"])
    assert out["network"] == []
    assert out["errors"] == []


def test_insert_reply_fallback_fires_input_events_without_sending():
    out = run_scenario("insert_reply_fallback")
    assert out["result"] == {"returned": True, "boxText": "Fallback text"}
    assert [e["type"] for e in out["events"]] == ["beforeinput", "input", "change"]
    assert not sent_something(out["events"])


def test_insert_reply_reports_failure_when_no_box_or_no_text():
    out = run_scenario("insert_reply_no_box")
    assert out["result"] == {"returned": False, "emptyReturned": False}
    assert out["events"] == []


def test_unread_precheck_fills_cache_with_no_network_call():
    out = run_scenario("scan_unread")
    result = out["result"]
    assert result["cacheSize"] == 2  # two unread chats cached, the read chat skipped
    assert result["cacheSizeAfterRescan"] == 2  # same previews again: nothing recomputed
    assert result["previews"] == {
        "Tan Bros Trading": "Boss, 5 units Daikin 1.5HP, got stock?",
        "Ah Seng": "How much for R32 gas?",
    }
    assert result["tanBrosSource"] == "local_smart_engine"
    assert result["tanBrosIntent"] == "BUYING_INQUIRY"
    assert result["pillText"].endswith("2 Pre-Cached")
    assert out["network"] == []
    assert out["errors"] == []


def test_sidebar_builds_and_lists_its_boot_network_calls():
    """createSidebar() builds the panel. Boot calls are recorded as facts for later phases, not forbidden."""
    out = run_scenario("sidebar_boot")
    result = out["result"]
    assert out["errors"] == []
    assert result["rootExists"] is True
    for element_id in ("cc-big-action-btn", "cc-read-dom-btn", "cc-draft-output", "cc-customer-input", "cc-reply-tabs"):
        assert element_id in result["ids"]
    assert result["observers"] == 1
    # Boot may check login and read the state (customers, deals, reps). No chat content, no client lookup ("Client" placeholder).
    assert boot_calls(result["bootNetwork"]) == [("CC_AUTH_STATUS", ""), ("CC_API_FETCH", "/api/state")]


BOOT_ONLY = [("CC_AUTH_STATUS", ""), ("CC_API_FETCH", "/api/state")]


def test_switching_chats_and_new_messages_send_nothing():
    out = run_scenario("sidebar_chat_activity_is_local")
    result = out["result"]
    assert out["errors"] == []
    boot = [(c["type"], c["path"]) for c in result["afterBoot"]]
    assert boot == BOOT_ONLY
    # client's message is read into the panel locally, but nothing is sent: no analyze, no client/memory
    assert result["afterFirstChat"] == len(BOOT_ONLY)
    assert [(c["type"], c["path"]) for c in result["final"]] == BOOT_ONLY
    assert result["customer"] == "Tan Bros Trading"  # the panel still follows the open chat, locally
    assert result["message"] == "Hello??"
    assert result["memPill"] == "Client Ready"
    assert result["displayAfterMum"] == "Mum"  # the header follows the open chat, customer or not
    assert result["display"] == "Tan Bros Trading"
    assert result["pdfButton"] is False  # a PDF gets a hint, not the photo button
    assert "please type the items" in result["pdfBanner"]


def test_analyse_click_sends_the_open_chat_once():
    out = run_scenario("sidebar_analyse_click")
    result = out["result"]
    assert out["errors"] == []
    assert result["before"] == len(BOOT_ONLY)  # opening the chat sent nothing
    sent = result["final"][result["before"]:]
    analyze = posts(sent, "/api/whatsapp/analyze")
    assert len(analyze) == 1
    assert analyze[0]["body"]["customer"] == "Tan Bros Trading"
    assert analyze[0]["body"]["message"] == "Boss, got 5 Daikin 1.5HP? how much"
    paths = [c["path"] for c in sent]
    assert paths.count("/api/client/memory?customer=Tan%20Bros%20Trading") == 1
    assert set(paths) <= {"/api/whatsapp/analyze", "/api/client/memory?customer=Tan%20Bros%20Trading", "/api/state"}


PHOTO_REPLY = {"ok": True, "data": {"status": "extracted", "analysis": {
    "intent": "BUYING_INQUIRY", "extTitle": "Photo Order Quote for Tan Bros Trading", "extDraft": "Hi"}}}


def test_customer_photo_offers_a_button_and_sends_only_on_click():
    out = run_scenario("sidebar_photo_quote", backendResponse=PHOTO_REPLY)
    result = out["result"]
    assert out["errors"] == []
    assert result["afterArrival"] == result["before"] == len(BOOT_ONLY)  # photo arrived: no network
    assert result["shown"]["bannerDisplay"] == "block"
    assert "Quote from photo" in result["shown"]["buttonText"]
    sent = result["final"][result["before"]:]
    assert [c["path"] for c in sent] == ["/api/whatsapp/photo-quote"]
    body = sent[0]["body"]
    assert body["customer"] == "Tan Bros Trading"
    assert body["imageBase64"].startswith("data:image/")
    assert result["title"] == "Photo Order Quote for Tan Bros Trading"
    assert not any("/api/ocr/extract" in c["path"] for c in result["final"])


def test_second_photo_replaces_the_first_and_double_click_sends_once():
    out = run_scenario("sidebar_second_photo", backendResponse=PHOTO_REPLY)
    assert out["errors"] == []
    sent = out["result"]["sent"]
    assert len(sent) == 1  # two clicks, one request
    assert sent[0]["body"]["imageBase64"].endswith("photoimg2")  # the newest photo, not the first


def test_photo_answer_is_dropped_if_the_chat_changed():
    out = run_scenario("sidebar_photo_then_chat_changed", backendResponse=PHOTO_REPLY)
    assert out["result"]["title"] != "Photo Order Quote for Tan Bros Trading"


def test_editing_fields_sends_nothing_and_keeps_own_draft():
    out = run_scenario("sidebar_field_edit_and_draft")
    result = out["result"]
    assert out["errors"] == []
    assert result["calls"] == len(BOOT_ONLY)  # change events on the fields did not analyse
    assert result["sameChat"] == "Hi boss, typing my own reply"  # new message, same chat: draft kept
    assert result["otherChat"] == ""  # other chat: cleared
    assert result["btn"] == "✅ Insert Selected Reply"


# ---- customers only (docs/11 §5): a friend's chat is never sent; Add as customer enables the contact
ANALYZE, PHOTO, CUSTOMERS, STATE = ("/api/whatsapp/analyze", "/api/whatsapp/photo-quote", "/api/customers", "/api/state")
NOT_A_CUSTOMER = {"ok": True, "data": {"status": "not_a_customer", "analysis": {
    "intent": "NOT_A_CUSTOMER", "isCustomer": False, "badge": "Not a customer", "extTitle": "Tan Bros Trading (Not in Directory)",
    "extDraft": "Hi Tan Bros Trading, thanks for reaching out!", "extBtnLabel": "Add as customer",
    "replyOptions": [{"label": "Register Contact", "text": "Hi Tan Bros Trading, thanks for reaching out!"}]}}}


def paths(calls):
    return [(c.get("method"), c.get("path")) for c in calls]


def test_friend_chat_says_not_a_customer_and_no_button_sends_anything():
    out = run_scenario("cust_friend_chat")
    result = out["result"]
    assert out["errors"] == []
    shown = result["shown"]
    assert shown["badge"] == "Not a customer" and "Not a customer" in shown["title"]
    assert shown["button"] == "➕ Add as customer"
    assert shown["customer"] == "Mum"
    assert shown["draft"] == "" and shown["tabs"] == 0  # no sales draft, no reply tabs
    assert result["afterOpen"] == []  # opening the chat sent nothing
    assert paths(result["sent"]) == [("GET", STATE)]  # Rescan only re-reads the customer list; Ask AI and Enter sent nothing
    assert result["bannerDisplay"] == "none" and result["photoButton"] is False  # no photo button for a non-customer
    assert result["final"]["button"] == "➕ Add as customer"


@pytest.mark.parametrize("title, customers", [
    ("Tan Bros Trading", [{"name": "Tan Bros Trading", "phone": ""}]),
    ("TAN BROS TRADING (Phone Order)", [{"name": "Tan Bros Trading", "phone": ""}]),
    ('"Tan Bros Trading"!', [{"name": "Tan Bros Trading", "phone": ""}]),  # backend clean_customer_name trims !?,.:;*#-_"' too
    ("+60 19-888 7766", [{"name": "Ah Seng", "phone": "0198887766"}]),
    ("+60 12-345 6789", [{"name": "Ahmad", "phone": "+60 12-345 6789"}]),
    ("0123456789", [{"name": "Ahmad", "phone": "+60 12-345 6789"}]),
    ("+60 12-345 6789", [{"name": "Ahmad", "phone": "0123456789"}]),
])
def test_customer_chat_is_idle_then_rescan_sends_one_analyze(title, customers):
    out = run_scenario("cust_customer_chat", title=title, customers=customers)
    result = out["result"]
    assert out["errors"] == []
    assert result["shown"]["badge"] != "Not a customer"
    assert "Tap" in result["shown"]["check"] and "Rescan" in result["shown"]["check"]
    assert result["afterOpen"] == []
    assert len(posts(result["sent"], ANALYZE)) == 1
    body = posts(result["sent"], ANALYZE)[0]["body"]
    assert body["customer"] == title
    digits = "".join(ch for ch in title if ch.isdigit())
    assert body["phone"] == (digits if len(digits) >= 7 else "")  # a number title sends its digits (name-only backend lookup)


def test_short_numbers_and_other_numbers_do_not_match():
    for title, customers in [("123456", [{"name": "A", "phone": "123456"}]), ("+60 19-888 7766", [{"name": "Ahmad", "phone": "0123456789"}])]:
        shown = run_scenario("cust_customer_chat", title=title, customers=customers)["result"]["shown"]
        assert shown["badge"] == "Not a customer", title  # under 7 digits never matches; different numbers do not match


@pytest.mark.parametrize("via", ["click", "enter"])
def test_ask_ai_and_enter_each_send_one_analyze(via):
    out = run_scenario("cust_ask_ai", via=via)
    sent = posts(out["result"]["sent"], ANALYZE)
    assert out["errors"] == []
    assert len(sent) == 1
    assert sent[0]["body"]["userInstruction"] == "give 10% discount"


@pytest.mark.parametrize("title, name, phone", [
    ("Mum", "Mum", ""),
    ("Mum (Friend)", "Mum", ""),
    ("Mum!", "Mum", ""),
    ("+60 19-888 7766", "+60 19-888 7766", "60198887766"),
])
def test_add_as_customer_posts_once_then_rescan_analyses(title, name, phone):
    out = run_scenario("cust_add", title=title, double=True)
    result = out["result"]
    assert out["errors"] == []
    assert result["before"]["button"] == "➕ Add as customer"
    after = [c for c in result["afterAdd"] if c["path"] in (CUSTOMERS, STATE, ANALYZE)]
    assert paths(after) == [("POST", CUSTOMERS), ("GET", STATE)]  # double click: one POST, then the refresh
    assert posts(after, CUSTOMERS)[0]["body"] == {"name": name, "phone": phone, "role": "OWNER"}
    assert result["added"]["badge"] != "Not a customer" and "Rescan" in result["added"]["check"]  # idle, not analysed
    assert len(posts(result["afterAdd"], ANALYZE)) == 0
    assert len(posts(result["final"], ANALYZE)) == 1  # only the Rescan click analyses


def test_add_as_customer_error_is_shown_and_button_stays():
    out = run_scenario("cust_add", responses={CUSTOMERS: {"ok": False, "status": 500}})
    added = out["result"]["added"]
    assert "Couldn't add" in added["check"]
    assert added["button"] == "➕ Add as customer" and added["badge"] == "Not a customer"
    assert len(posts(out["result"]["final"], ANALYZE)) == 0  # still not a customer: Rescan sends nothing


def test_backend_not_a_customer_shows_add_button_without_stub_reply():
    out = run_scenario("cust_backend_says_no", responses={ANALYZE: NOT_A_CUSTOMER})
    result = out["result"]
    assert out["errors"] == []
    assert len(posts(result["afterAnalyze"], ANALYZE)) == 1
    shown = result["shown"]
    assert shown["badge"] == "Not a customer" and shown["button"] == "➕ Add as customer"
    assert shown["draft"] == "" and shown["tabs"] == 0  # no "Hi X!" reply tabs
    assert result["boxText"] == ""  # the big button did not insert anything
    assert len(posts(result["afterClick"], CUSTOMERS)) == 1  # it adds the customer instead
    assert not posts(result["afterClick"], "/api/whatsapp/execute")


def test_state_failed_to_load_sends_nothing_and_says_offline():
    out = run_scenario("cust_state_offline", stateFails=99)
    result = out["result"]
    assert out["errors"] == []
    assert "Can't check the customer list" in result["shown"]["title"]
    assert result["afterOpen"] == []
    assert paths(result["sent"]) == [("GET", STATE)]  # Rescan only retries the customer list
    assert not posts(result["sent"], ANALYZE) and not posts(result["sent"], CUSTOMERS)
    assert "Can't check the customer list" in result["final"]["title"]


def test_rescan_retries_the_customer_list_and_recovers():
    out = run_scenario("cust_state_offline", stateFails=1)  # the boot read fails, the retry works
    result = out["result"]
    assert "Can't check the customer list" in result["shown"]["title"]
    assert paths(result["sent"]) == [("GET", STATE)]  # retry only; the chat is not analysed
    assert result["final"]["badge"] != "Not a customer" and "Rescan" in result["final"]["check"]


def test_phone_title_sends_its_digits_in_analyze_execute_and_photo_quote():
    analysis = {"ok": True, "data": {"analysis": {"intent": "BUYING_INQUIRY", "extTitle": "Quote", "extDraft": "Hi",
                                                   "extActionType": "CREATE_QUOTE_HOLD", "extBtnLabel": "Hold"}}}
    out = run_scenario("cust_phone_bodies", title="+60 19-888 7766", customers=[{"name": "Ah Seng", "phone": "0198887766"}],
                       responses={ANALYZE: analysis, PHOTO: PHOTO_REPLY})
    sent = out["result"]["sent"]
    assert out["errors"] == []
    for path in (ANALYZE, "/api/whatsapp/execute", PHOTO):
        body = posts(sent, path)[0]["body"]
        assert body["phone"] == "60198887766", path
    # The memory pill sends the digits too, so a number-titled customer gets their own tier, not "New Client".
    assert ("GET", "/api/client/memory?customer=%2B60%2019-888%207766&phone=60198887766") in paths(sent)


def test_rescan_on_not_a_customer_rereads_the_list_without_analysing():
    out = run_scenario("cust_stale_list", customers=[{"name": "Ah Seng", "phone": ""}])
    result = out["result"]
    assert out["errors"] == []
    assert result["blocked"]["badge"] == "Not a customer"
    assert paths(result["afterFirstRescan"]) == [("GET", STATE)]  # list read only: no analyze, no client memory
    assert result["idle"]["badge"] != "Not a customer" and "Rescan" in result["idle"]["check"]
    assert result["banner"] == "block"  # the photo button is back now that Mum is a customer
    assert paths(result["final"]) == [("GET", STATE), ("GET", "/api/client/memory?customer=Mum"), ("POST", ANALYZE), ("GET", STATE)]


# ---- sales sidebar (docs/11 §5, docs/08 §1): no stock anywhere, follow-ups + commission, deal line, execute body
STOCK_WORDING = re.compile(r"warehouse|ready stock|lock stock|hold stock|stock locked|\b\d+x [A-Z]{3}\b.*Avail", re.I)
EXECUTE = "/api/whatsapp/execute"
DEALS = [
    {"id": "QT-1", "customer": "Tan Bros Trading", "repId": 1, "stage": "FOLLOW_UP", "amount": 6650, "paused": False},
    {"id": "QT-2", "customer": "Ah Seng", "repId": 2, "stage": "FOLLOW_UP", "amount": 900, "paused": False},
    {"id": "QT-3", "customer": "Klinik Dr. Lim", "repId": 1, "stage": "FOLLOW_UP", "amount": 500, "paused": True},  # paused: not due
    {"id": "QT-4", "customer": "Wisma Perdana", "repId": 2, "stage": "QUOTED", "amount": 3000, "paused": False},  # not due yet
    {"id": "QT-5", "customer": "Kedai Runcit Ah Seng", "repId": 1, "stage": "FOLLOW_UP", "amount": 700, "paused": False},
    {"id": "QT-6", "customer": "Bengkel Ali", "repId": 2, "stage": "FOLLOW_UP", "amount": 800, "paused": False},
]
REPS = [
    {"id": 2, "name": "Brian", "commissionRm": 120, "rank": 2},
    {"id": 1, "name": "Aina", "commissionRm": 200, "rank": 1},
]
PRODUCTS = [  # odd prices on purpose: they must come from here, never from the extension
    {"sku": "ACN-DAI-15", "name": "Daikin 1.5HP Inverter Unit", "sellPrice": 1111},
    {"sku": "ACN-DAI-10", "name": "Daikin 1.0HP Inverter Unit", "sellPrice": 999},
    {"sku": "GAS-R32", "name": "R32 Refrigerant Gas (3kg)", "sellPrice": 77},
    {"sku": "PIP-COP-3M", "name": "Copper Pipe 3m Set", "sellPrice": 33},
]
STATE_STUB = {"deals": DEALS, "reps": REPS, "products": PRODUCTS}
BUYING = "Boss, 5 Daikin 1.5HP and 2 R32 gas, got stock? how much"


def quote_analysis(**extra):
    """An analyze answer shaped like docs/11 §2.4 for a 5-unit quote on deal QT-1."""
    analysis = {"intent": "BUYING_INQUIRY", "badge": "Price quote", "extTitle": "Quote for Tan Bros Trading",
                "extCheck": "5x Daikin 1.5HP = RM 6,650\nSubject to stock availability", "extDraft": "Hi boss, RM 6,650.",
                "replyOptions": [{"label": "English", "text": "Hi boss, RM 6,650."}], "extActionType": "CREATE_QUOTE",
                "extBtnLabel": "Send quote & insert reply", "dealId": "QT-1", "amount": 6650, "discount": 0,
                "items": [{"sku": "ACN-DAI-15", "name": "Daikin 1.5HP", "qty": 5, "unitPrice": 1150}],
                "marginOk": True, "commissionRm": 200, "followUp": {"count": 1, "of": 3}}
    analysis.update(extra)
    return {"ok": True, "data": {"analysis": analysis}}


def test_sidebar_shows_followups_due_and_commission_and_no_stock_wording():
    out = run_scenario("sales_card", state=STATE_STUB)
    result = out["result"]
    assert out["errors"] == []
    assert not STOCK_WORDING.search(result["sidebar"]), result["sidebar"]
    assert result["stockCardIds"] == []
    assert result["followups"] == "4 due: Tan Bros Trading, Ah Seng, Kedai Runcit Ah Seng..."  # paused and QUOTED deals are not due; first 3 names
    assert result["commission"] == "#1 Aina RM 200 · #2 Brian RM 120"
    assert "Follow-ups due" in result["sidebar"] and "Commission this month" in result["sidebar"]


def test_sidebar_follow_up_card_says_so_when_nothing_is_due_or_backend_is_down():
    quiet = run_scenario("sales_card", state={"deals": [DEALS[3]], "reps": []})["result"]
    assert quiet["followups"] == "None due now" and quiet["commission"] == "No reps yet"
    down = run_scenario("sales_card", stateFails=1)["result"]
    assert down["followups"] == "Backend offline" and not STOCK_WORDING.search(down["sidebar"])


def test_extension_files_never_mention_stock_except_the_quote_disclaimer():
    banned = ("ready stock", "lock stock", "hold stock", "stock locked", "stock hold", "no stock", "live stock",
              "warehouse", "cc-stock", "cc-live-stock")
    manifest = (ROOT / "extension" / "manifest.json").read_text(encoding="utf-8")
    assert "stock" not in manifest.lower()
    for name in ("content.js", "background.js", "sidebar.css"):
        path = Path(os.environ.get("CC_CONTENT_JS") or "") if name == "content.js" and os.environ.get("CC_CONTENT_JS") else ROOT / "extension" / name
        source = path.read_text(encoding="utf-8")
        assert not [b for b in banned if b in source.lower()], name
        # What is left may only be the legal wording, or the words that tell a customer's stock question apart.
        for line in source.splitlines():
            if "stock" in line.lower():
                assert "Subject to stock availability" in line or "stok|stock" in line, line


def test_rescan_shows_rep_stage_follow_up_total_margin_and_commission():
    out = run_scenario("sales_rescan", state=STATE_STUB, responses={ANALYZE: quote_analysis()})
    result = out["result"]
    assert out["errors"] == []
    deal = result["deal"]
    assert "Rep: Aina" in deal and "Stage: FOLLOW_UP" in deal and "Follow-up 1 of 3" in deal
    assert "Quote total: RM 6,650" in deal
    assert "Margin ✓ · You earn RM 200" in deal
    assert result["button"] == "Send quote & insert reply"
    assert not STOCK_WORDING.search(result["sidebar"])


def test_below_margin_floor_warns_and_shows_no_margin_percent_or_commission():
    out = run_scenario("sales_rescan", state=STATE_STUB, responses={ANALYZE: quote_analysis(
        marginOk=False, commissionRm=None, extActionType="ASK_OWNER", extBtnLabel="Ask boss")})
    deal = out["result"]["deal"]
    assert "⚠ Below margin floor — needs Owner approval" in deal
    assert "Margin ✓" not in deal and "You earn" not in deal and "%" not in deal


def test_deal_line_leaves_out_what_the_analysis_does_not_have():
    # No dealId, no commission, no follow-up, not a quote: no rep, stage, "n of 3" or "You earn" is invented.
    out = run_scenario("sales_rescan", state=STATE_STUB, responses={ANALYZE: quote_analysis(
        dealId=None, commissionRm=None, followUp=None, extActionType="REPLY_ONLY")})
    assert out["result"]["deal"] == "Quote total: RM 6,650\nMargin ✓"
    casual = run_scenario("sales_rescan", state=STATE_STUB, responses={ANALYZE: {"ok": True, "data": {"analysis": {
        "intent": "CASUAL_CHAT", "extTitle": "Chatting", "extDraft": "Hi", "extActionType": "NO_ACTION"}}}})
    assert casual["result"]["deal"] == ""


def test_offline_guess_for_a_buying_message_has_the_disclaimer_and_no_stock_claims():
    out = run_scenario("local_analysis", message=BUYING, products=PRODUCTS)
    result = out["result"]
    assert result["intent"] == "BUYING_INQUIRY" and result["actionType"] == "REPLY_ONLY"
    assert result["amount"] == 5 * 1111 + 2 * 77  # priced from the loaded list: not the 1.0HP, not the pipes
    assert len(result["replies"]) == 4
    for reply in result["replies"]:
        assert "Subject to stock availability" in reply, reply
    assert "Subject to stock availability" in result["check"]
    everything = " ".join(result["replies"] + [result["check"], result["title"], result["button"], result["memory"]])
    assert not STOCK_WORDING.search(everything)
    assert not re.search(r"stock (hold|lock)|(hold|lock) stock|no stock|stock is", everything, re.I)
    assert not {"sku", "qty", "extraSku", "extraQty"} & set(result["keys"])  # no invented SKUs for the execute body


def test_offline_guess_for_casual_chat_has_no_quote_and_no_stock_wording():
    result = run_scenario("local_analysis", message="Dinner at 7?")["result"]
    assert result["intent"] == "CASUAL_CHAT" and result["actionType"] == "NO_ACTION"
    assert not STOCK_WORDING.search(" ".join(result["replies"] + [result["check"]]))


@pytest.mark.parametrize("extra, expected", [
    # counter-offer: items cut down to sku + qty, discount from the analysis, nothing else
    ({"extActionType": "SEND_COUNTER_OFFER", "discount": 300, "amount": 6350, "sku": "ACN-DAI-15", "qty": 5, "extraSku": "GAS-R32",
      "extraQty": 5, "quotePreview": {"items": [{"sku": "OLD", "qty": 9}]}},
     {"actionType": "SEND_COUNTER_OFFER", "dealId": "QT-1", "items": [{"sku": "ACN-DAI-15", "qty": 5}], "discount": 300}),
    # slip reference box
    ({"extActionType": "MARK_WON", "depositRef": "DN-123", "depositAmount": 2000},
     {"actionType": "MARK_WON", "dealId": "QT-1", "items": [{"sku": "ACN-DAI-15", "qty": 5}], "discount": 0,
      "depositRef": "DN-123", "depositAmount": 2000}),
    ({"extActionType": "MARK_LOST", "lossReasonSuggestion": "Price"},
     {"actionType": "MARK_LOST", "dealId": "QT-1", "items": [{"sku": "ACN-DAI-15", "qty": 5}], "discount": 0, "reason": "Price"}),
    ({"extActionType": "SAVE_LHDN_TIN", "tin": "C2588190021", "ssmBrn": "201901000001", "dealId": None, "items": None, "discount": None},
     {"actionType": "SAVE_LHDN_TIN", "tin": "C2588190021", "ssmBrn": "201901000001"}),
])
def test_main_button_sends_only_the_contract_fields_from_the_analysis(extra, expected):
    out = run_scenario("sales_execute", state=STATE_STUB, responses={
        ANALYZE: quote_analysis(**extra), EXECUTE: {"ok": True, "data": {"status": "ok"}}})
    result = out["result"]
    assert out["errors"] == []
    sent = posts(result["sent"], EXECUTE)
    assert len(sent) == 1
    body = sent[0]["body"]
    assert body.pop("role") in ("OWNER", "STAFF")
    assert body == {"customer": "Tan Bros Trading", "phone": "", **expected}  # no sku/qty/extraSku/amount, no invented defaults
    assert result["boxText"] == "Hi boss, RM 6,650."  # the reply is still inserted, not sent


def test_pending_approval_tells_the_rep_it_went_to_the_owner():
    out = run_scenario("sales_execute", state=STATE_STUB, responses={
        ANALYZE: quote_analysis(extActionType="ASK_OWNER", discount=900, marginOk=False),
        EXECUTE: {"ok": True, "data": {"status": "pending_approval"}}})
    assert out["errors"] == []
    assert "Sent to Owner for Approval" in out["result"]["button"]


# ---- review round: prices only from the price list, items for CREATE_QUOTE, new-quote stage, no invented figures
def test_offline_guess_prices_from_the_loaded_price_list_only():
    result = run_scenario("local_analysis", message=BUYING, products=PRODUCTS)["result"]
    text = " ".join(result["replies"] + [result["check"]])
    assert "5x Daikin 1.5HP Inverter Unit (RM 5,555)" in text and "2x R32 Refrigerant Gas (3kg) (RM 154)" in text
    assert "RM 5,709" in text
    for old_hard_coded in ("1,150", "6,650", "180", "999", "Copper"):  # the old fixed prices, the 1.0HP, the unmatched pipes
        assert old_hard_coded not in text, old_hard_coded
    assert "40%" not in text  # no invented deposit either


@pytest.mark.parametrize("products, message", [
    (None, BUYING),  # price list not loaded (backend never answered)
    ([], BUYING),
    (PRODUCTS, "Hi boss, can you send me a quote please?"),  # loaded, but nothing in the message names a product
])
def test_offline_guess_without_a_price_says_no_rm_at_all(products, message):
    opts = {"message": message}
    if products is not None:
        opts["products"] = products
    result = run_scenario("local_analysis", **opts)["result"]
    everything = " ".join(result["replies"] + [result["check"], result["title"], result["button"]])
    assert "RM" not in everything and not re.search(r"\d", everything), everything
    assert result["amount"] == 0 and result["actionType"] == "REPLY_ONLY"
    assert "confirm the price" in result["replies"][0]


def test_backend_down_fallback_draft_is_priced_from_the_list_or_has_no_rm():
    down = {"ok": False, "status": 503}
    priced = run_scenario("sales_rescan", state=STATE_STUB, responses={ANALYZE: down})["result"]
    assert "RM 5,555" in priced["draft"] and "Subject to stock availability" in priced["draft"]
    assert priced["deal"] == "Quote total: RM 5,555"  # a real-list total, no margin or commission claimed
    bare = run_scenario("sales_rescan", state={"deals": DEALS, "reps": REPS}, responses={ANALYZE: down})["result"]
    assert "RM" not in bare["draft"] and bare["deal"] == ""


def test_new_quote_without_a_deal_shows_new_quote_not_the_chat_stage():
    out = run_scenario("sales_rescan", state=STATE_STUB, responses={ANALYZE: quote_analysis(
        dealId=None, stage="NEGOTIATING", followUp=None)})
    deal = out["result"]["deal"]
    assert deal.startswith("Stage: New quote\n") and "NEGOTIATING" not in deal and "Rep:" not in deal
    named = run_scenario("sales_rescan", state=STATE_STUB, responses={ANALYZE: quote_analysis(
        dealId=None, followUp=None, repId=2)})["result"]["deal"]
    assert named.startswith("Rep: Brian · Stage: New quote\n")
    assert "[Chat stage: NEGOTIATING]" in run_scenario("sales_rescan", state=STATE_STUB, responses={ANALYZE: quote_analysis(
        stage="NEGOTIATING")})["result"]["sidebar"]  # the chat stage stays labelled as such


EDITORS = [
    ("Credit rebate offer", "cc-rebate-amt-input", "50", "deduct RM 50 credit rebate"),
    ("Technician slot", "cc-tech-time-input", "after 5pm", "drop by after 5pm"),
]


@pytest.mark.parametrize("label, input_id, typed, expected", EDITORS)
def test_reply_editors_start_empty_and_build_nothing_until_a_value_is_typed(label, input_id, typed, expected):
    analysis = quote_analysis(replyOptions=[{"label": "English", "text": "Hi boss"}, {"label": label, "text": "Original reply"}])
    out = run_scenario("sales_editor", state=STATE_STUB, input=input_id, typed=typed, responses={ANALYZE: analysis})
    result = out["result"]
    assert out["errors"] == []
    assert result["opened"]["value"] == "" and result["opened"]["draft"] == "Original reply"  # no 180 / 3 PM default
    assert result["afterEmpty"] == {"draft": "Original reply", "button": result["opened"]["button"]}  # empty: nothing built
    assert expected in result["afterTyped"]["draft"]


def test_create_quote_without_items_posts_nothing_and_asks_for_items():
    analysis = quote_analysis(items=None, sku=None, qty=None)
    out = run_scenario("sales_execute", state=STATE_STUB, responses={ANALYZE: analysis, EXECUTE: {"ok": True, "data": {"status": "ok"}}})
    result = out["result"]
    assert posts(result["sent"], EXECUTE) == []
    assert "Type the items to quote" in result["button"]
    assert result["boxText"] == ""  # no reply inserted for a quote that cannot be recorded


@pytest.mark.parametrize("extra, items", [
    ({"items": None, "sku": "ACN-DAI-15", "qty": 3}, [{"sku": "ACN-DAI-15", "qty": 3}]),
    ({"items": None, "sku": "ACN-DAI-15", "qty": 3, "extraSku": "GAS-R32", "extraQty": 2},
     [{"sku": "ACN-DAI-15", "qty": 3}, {"sku": "GAS-R32", "qty": 2}]),
    ({"items": None, "quotePreview": {"items": [{"sku": "PIP-COP-3M", "qty": 4, "name": "Pipe", "unitPrice": 33}]}},
     [{"sku": "PIP-COP-3M", "qty": 4}]),
])
def test_create_quote_items_fall_back_to_the_preview_then_the_analysis_sku_and_qty(extra, items):
    out = run_scenario("sales_execute", state=STATE_STUB, responses={
        ANALYZE: quote_analysis(**extra), EXECUTE: {"ok": True, "data": {"status": "ok"}}})
    sent = posts(out["result"]["sent"], EXECUTE)
    assert len(sent) == 1 and sent[0]["body"]["items"] == items
    assert sent[0]["body"]["actionType"] == "CREATE_QUOTE"


def test_mark_won_without_a_slip_reference_posts_nothing_and_says_so():
    out = run_scenario("sales_execute", state=STATE_STUB, responses={
        ANALYZE: quote_analysis(extActionType="MARK_WON"), EXECUTE: {"ok": True, "data": {"status": "ok"}}})
    result = out["result"]
    assert posts(result["sent"], EXECUTE) == []
    assert "Add the slip reference first" in result["button"]


# ---- re-review: the quantity must be a clear whole number, else no RM total (the rep Rescans)
@pytest.mark.parametrize("message, amount", [
    ("2 daikin 1.5hp", 2 * 1111),
    ("Boss, 5 Daikin 1.5 HP and 2 R32 gas", 5 * 1111 + 2 * 77),
    ("daikin 1.5hp", 1111),  # no number at all: one unit
    ("daikin 1.5hp x5", 5 * 1111),  # a trailing "x5" is read
    ("daikin 1.5hp 3 units", 3 * 1111),
    ("99 daikin 1.5hp", 99 * 1111),
    ("5 daikin 1.5hp 2 r32 gas", 5 * 1111 + 2 * 77),  # a clear leading number wins over digits that follow
])
def test_offline_guess_reads_a_clear_quantity(message, amount):
    result = run_scenario("local_analysis", message=message, products=PRODUCTS)["result"]
    assert result["amount"] == amount, message
    assert f"RM {amount:,}" in result["replies"][0]


@pytest.mark.parametrize("message", [
    "call 0123456789 daikin 1.5hp",  # a phone number is not a quantity
    "+60 12 345 6789 daikin 1.5hp",
    "got 1.5 daikin 1.5hp",  # "1.5" is not 5
    "100 daikin 1.5hp",  # over 99
    "0 daikin 1.5hp",
    "daikin 1.5hp 3",  # a bare number after the name: unclear
])
def test_offline_guess_with_an_unclear_quantity_has_no_rm_total(message):
    result = run_scenario("local_analysis", message=message, products=PRODUCTS)["result"]
    everything = " ".join(result["replies"] + [result["check"]])
    assert result["amount"] == 0 and "RM" not in everything, message
    assert "confirm the price" in result["replies"][0]


@pytest.mark.parametrize("customer", ["Tan Bros Trading", "Klinik Dr. Lim", "Kedai Runcit Ah Seng", "Wisma Perdana", "Someone New"])
def test_demo_client_memory_has_no_made_up_rm_or_percent_figures(customer):
    result = run_scenario("local_analysis", message=BUYING, products=PRODUCTS, customer=customer)["result"]
    memory = json.loads(result["memory"])
    words = f"{memory['styleSummary']} {memory['paymentBehavior']}"
    assert "RM" not in words and "%" not in words and not re.search(r"\d", words), words


def test_demo_mode_reads_a_friend_chat_like_a_customer():
    """Backend CUSTOMERS_ONLY=false (company.customersOnly false): no "Not a customer" gate; Rescan analyses."""
    out = run_scenario("cust_customer_chat", title="Mum", state={"company": {"customersOnly": False}})
    result = out["result"]
    assert out["errors"] == []
    assert result["shown"]["badge"] != "Not a customer" and result["shown"]["button"] != "➕ Add as customer"
    assert result["afterOpen"] == []  # opening the chat still sends nothing until Rescan
    assert ("POST", ANALYZE) in paths(result["sent"])
