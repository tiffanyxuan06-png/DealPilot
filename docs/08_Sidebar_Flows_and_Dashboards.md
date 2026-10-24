# WhatsApp Sidebar, User Flows and Dashboards

> Part of the sales-agent plan (see `06_Sales_Agent_Implementation_Roadmap.md`). Draft agreed in planning on 22 Oct 2026.
> 销售助理方案的一部分：WhatsApp 侧边栏、业务员与老板流程、两个看板。

---

## 1. The WhatsApp sidebar / WhatsApp 侧边栏

**One line for the pitch / 推介用一句话：**
> "A sales copilot that sits right beside the WhatsApp Web chat. Open a customer's chat and it reads what they want, prices it from your price list, drafts the reply, and tells you the next step, all in one click."
>
> "坐在 WhatsApp Web 聊天旁边的销售助手。打开客户聊天，它读懂需求、按价目表算价、起草回复、告诉你下一步，一键完成。"

### Layout, top to bottom / 从上到下

```
┌──────────────────────────────────┐
│ Tan Bros Trading    ⭐ Trusted 94 │  ← customer card: rating, rep,
│ Rep: Aina · TIN ✓ · QUOTED       │     TIN status, deal stage
├──────────────────────────────────┤
│ What they want                   │  ← what the AI read (text or photo)
│ 5x Daikin 1.5HP · 5x R32 Gas     │
├──────────────────────────────────┤
│ Quote QT-2026-104                │  ← priced by code from the price list
│ 5 × RM 1,150 = RM 5,750          │
│ 5 × RM   180 = RM   900          │
│ Total          RM 6,650          │
│ Margin ✓       You earn RM 200   │  ← margin guard + commission
│ Subject to stock availability    │
├──────────────────────────────────┤
│ Pick a reply  ○ EN ● Manglish ○ BM│ ← reply options + "Adjust" box
├──────────────────────────────────┤
│ [ Send quote & insert reply ]    │  ← ONE main button
│ Follow-up in 48h                 │
└──────────────────────────────────┘
```

Reps see "Margin ✓ / ✗" only. Unit costs and margin % are owner-only.
业务员只看到"利润 ✓ / ✗"，成本价和利润百分比只有老板能看。

### What the main button does in each situation / 主按钮随情况变化

| Customer says / 客户在说什么 | Sidebar focus / 侧边栏重点 | Main button / 主按钮 |
|---|---|---|
| "Got stock? How much?" or a photo of a list | Priced quote | **Send quote** |
| "Boss, can less?" | Counter-offers above the margin floor; commission updates live | **Send counter-offer**, or **Ask boss** if below the floor |
| No reply for 48h | Polite nudge, "follow-up 2 of 3" | **Send follow-up** |
| "Ok confirm, banked in" | Slip reference box | **Mark won** |
| "Tak jadi boss" | Warm reply, pick a loss reason | **Mark lost** |
| "Item rosak!" | Apology; that customer's follow-ups pause | **Log complaint** |
| A colleague or friend | "Not a customer · Add as customer" | Nothing is sent to the AI |

### Privacy rules for the sidebar / 侧边栏隐私规则

1. **Allowlist:** only contacts marked as customers are analysed and remembered. / 只分析和记住标记为客户的联系人。
2. **Groups off by default:** the owner switches on each group that should be processed. / 群组默认关闭，老板逐个开启。
3. **Casual chat isn't saved:** when the AI detects casual chat, nothing goes into customer memory. The current code does save it, so this needs changing. / 闲聊不存入客户记忆（现有代码会存，要改）。
4. **Manual trigger:** the rep clicks "Analyse" before anything is sent to the AI. Whether the current extension sends automatically still has to be checked in `extension/content.js`. / 业务员点"分析"才发给 AI；现有插件是否自动发送，要查 `content.js`。
5. **We don't train the AI.** The model is used as-is; only the open chat is sent, to draft a reply. / 我们不训练 AI，只把当前聊天发去起草回复。

---

## 2. Sales agent flow / 业务员流程

1. **Morning:** open "My day" and see "3 follow-ups due today". / 早上打开"我的一天"，看到 3 个待跟进。
2. **Follow up:** click one → it opens that WhatsApp chat → the nudge is already drafted → **Send follow-up**. / 点击 → 打开聊天 → 已起草 → 发送跟进。
3. **New inquiry** (text or photo) → the sidebar prices it → pick a reply → **Send quote**. The deal becomes QUOTED and a 48h timer starts. / 新询价 → 自动算价 → 发送报价，开始 48 小时计时。
4. **Customer haggles** → counter-offers above the margin floor → send. If the customer wants more than the floor allows → **Ask boss** → the answer comes back to the sidebar. / 客户讲价 → 底线内还价；超过底线 → 请老板批准。
5. **Customer confirms** → paste the slip reference → **Mark won** → "+RM 200 commission". / 客户确认 → 填转账单号 → 标记成交 → 佣金增加。
6. **Customer declines** → **Mark lost** with a reason. **Customer complains** → **Log complaint**; follow-ups for that customer pause. / 婉拒 → 标记丢单并选原因；投诉 → 记录，暂停跟进。

### Sales agent's "My day" dashboard / 业务员看板

| Block / 区块 | Shows / 显示 |
|---|---|
| **Today's follow-ups** | Customer, deal value, "follow-up 2 of 3"; click opens the chat |
| **My commission** | Earned this month (estimate), target progress bar, potential commission from open deals |
| **My rank** | "You're #2 this month" (own rank only, see open question below) |
| **My deals** | Count and RM per stage: Inquiry, Quoted, Follow-up, Won, Lost |
| **Waiting for boss** | My discount requests and whether each is approved or rejected |
| **Paused customers** | Customers with an open complaint, with a "Clear" button |
| **Recent wins** | My last 5 won deals |

**Reps can't see / 业务员看不到：** other reps' amounts and commission, unit costs and margin %, the CSV download, settings and the price-list editor.

---

## 3. Boss flow / 老板流程

1. **Morning:** open the pipeline dashboard and check pipeline value, won this month and overdue follow-ups. / 早上看销售进度、本月成交、逾期跟进。
2. **Approvals:** "Aina wants RM 400 off QT-2026-110, margin 9% (floor 15%)" → **Approve** or **Reject** with a note. The result goes back to Aina's sidebar. / 审批折扣，结果回到业务员侧边栏。
3. **Check the team:** look at the leaderboard and who has the most overdue follow-ups → nudge them, or **Reassign** their customers. / 看排行榜和逾期，提醒或转移客户。
4. **At-risk deals:** big quotes on their third follow-up, and customers paused for complaints. / 高风险商机：第三次跟进的大单、投诉暂停的客户。
5. **Month end:** **Download CSV** of won orders → send to the accountant. Download the commission table to check before paying. / 月底下载成交 CSV 给会计，下载佣金表核对。
6. **Settings (occasionally):** price list, margin floor, reps and commission rates, follow-up hours, staff permissions. / 偶尔改设置：价目表、利润底线、业务员与佣金、跟进时间、权限。

### Boss dashboard / 老板看板

| Block / 区块 | Shows / 显示 |
|---|---|
| **Top numbers** | Pipeline value · Won this month · Win rate · Overdue follow-ups |
| **Approvals waiting** | Discount requests below the floor, with Approve / Reject |
| **Pipeline by stage** | A bar per stage with count and RM |
| **Rep leaderboard** | Per rep: won RM, commission, win rate, open deals, overdue follow-ups; Reassign button |
| **At-risk deals** | Third-follow-up quotes, big quotes going quiet, complaint pauses |
| **Why we lose** | Loss reasons: price, timing, competitor, no reply |
| **Activity log** | Every quote, approval, won/lost and reassignment |
| **Month-end** | **Download won-orders CSV** · **Download commission table** |

---

## 4. Commission rules / 佣金规则

| Rule | Proposal |
|---|---|
| **Basis** | Deal amount after discount, so a discount also lowers the rep's commission (works with the margin guard). / 按折扣后金额计算。 |
| **Rate** | One rate per rep for the hackathon (e.g. 3%); per-product rates later. / 黑客松每人一个比例。 |
| **When it counts** | In the month the deal is marked won. If a won deal is cancelled, the commission is reversed and logged. / 成交当月计入，取消则扣回并记录。 |
| **Visibility** | Reps see their own numbers; the owner sees everyone's. / 业务员看自己的，老板看全部。 |
| **Target** | Optional monthly target per rep with a progress bar. / 可选月目标与进度条。 |
| **Label** | Always "estimated commission". Actual pay is decided by the owner, so we don't clash with payroll. / 标为"预估佣金"，实际发放由老板决定。 |

```python
def deal_commission(deal, rep) -> int:
    # Commission on the amount after discount, so discounts cost the rep too.
    return round(deal["amount"] * rep["commission_pct"] / 100)

def rep_summary(deals, rep, month):  # month = "2026-10"
    mine = [d for d in deals if d["repId"] == rep["id"]]
    won = [d for d in mine if d["stage"] == "WON" and (d["wonAt"] or "").startswith(month)]
    open_ = [d for d in mine if d["stage"] in ("QUOTED", "FOLLOW_UP")]
    return {
        "wonRm": sum(d["amount"] for d in won),
        "commissionRm": sum(deal_commission(d, rep) for d in won),
        "potentialRm": sum(deal_commission(d, rep) for d in open_),
    }
```

Effort: about 2–3 hours (one calculation function and summary route, the sidebar line, "My commission" and the owner's leaderboard on the pipeline page).

---

## 5. Open questions / 待决定

1. **Can reps see the leaderboard?** Suggestion: each rep sees only their own rank, not other reps' amounts. / 业务员能看排行榜吗？建议只看自己的排名。
2. **Monthly targets:** include them in the hackathon demo, or later? / 月目标要不要放进演示？
3. **Demo accounts:** the simulated WhatsApp page for the main demo, plus about 30 seconds on real WhatsApp Web using two prepaid SIMs (registered with a teammate's IC, set up a few days early, with a pre-recorded backup video). / 演示：模拟页面为主，加 30 秒真实 WhatsApp（两张预付卡，提早开通，录视频备份）。
