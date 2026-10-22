# Data Layer Refactor Plan — SQL Migrations, SQLAlchemy, Pydantic

> Moves the database schema and demo data out of Python, puts every query behind SQLAlchemy, and types every row, response and setting with Pydantic. Do this **before Phase 3**, so the new WhatsApp code is written on the new data layer. Branch: `reposition-sales-crm`.
> 把表结构和演示数据移出 Python，查询统一走 SQLAlchemy，数据行、接口返回和设置都用 Pydantic 定义类型。在第三阶段之前完成。

> **✅ Built (22 Oct 2026).** 69 tests pass (2 known Phase 3 failures). Changes from the plan below, after review:
> - **No SQLite assumption.** The database comes from the required `DATABASE_URL` setting (`backend/config.py`). SQLite is for local testing only; Postgres comes later. Migrations live per database type: `backend/schema/migrations/sqlite/001_initial.sql` (a `postgresql/` folder is added when we switch). SQLite-only code (`executescript`, `PRAGMA foreign_keys`, `check_same_thread`) runs only when the URL is SQLite. `/api/health` shows only the database type, never the URL.
> - `backend/database.py` became `backend/services/pipeline.py` (state, follow-ups, margin, commission, activity log), `backend/services/business.py` (settings) and `backend/services/clock.py` (timestamps).
> - Tests: new `test/unit/test_data_layer.py` (ORM matches migrations, migrations apply once, seed files validate, `DATABASE_URL` required).

**Agreed choices (22 Oct 2026):**

| Topic | Decision |
|---|---|
| Migrations | Numbered `.sql` files + a small runner (no Alembic) |
| Queries | SQLAlchemy 2.0 (ORM models mapped to the tables the SQL files create) |
| Demo data | JSON files, loaded by a seeder |
| Pydantic | Request bodies, database rows, API responses, and settings (`pydantic-settings`) |

---

## 1. Today vs after / 现在 vs 之后

| | Today | After |
|---|---|---|
| Table definitions | `CREATE TABLE` strings in 4 Python files (`database.py`, `customers.py`, `permissions.py`, `memory.py`, which has a stale duplicate) | `backend/schema/migrations/*.sql` only |
| Schema changes | Edit Python; old databases rebuilt by a special case | Add `002_….sql`; the runner applies it once and records it |
| Queries | `sqlite3` with hand-written SQL in 58 places | SQLAlchemy sessions and ORM models |
| Demo data | Python dicts in `services/profiles.py` | `backend/schema/seeds/aircond.json`, `fnb.json`, `defaults.json` |
| Rows → API | Hand-built dicts (`_deal_dict`, `customers_payload`…) | Pydantic models (`Deal`, `Rep`, `StatePayload`…) used as FastAPI `response_model` |
| Settings | `backend/env.py` + `os.getenv` scattered + strings in the `settings` table | `AppSettings` (pydantic-settings, from `.env`) + `BusinessSettings` (typed view of the `settings` table) |

---

## 2. New layout / 新结构

```
backend/
  config.py                 # AppSettings (pydantic-settings): DB path, LM Studio, RunPod, Supabase, HOST, PORT
  db/
    engine.py               # SQLAlchemy engine + session_scope(); SQLite pragmas (foreign_keys=ON)
    orm.py                  # SQLAlchemy models: Setting, Product, Rep, Deal, AuditLog, ClientMemory,
                            #   Customer, RolePermission, ApprovalRequest
    migrate.py              # applies schema/migrations/*.sql in order, records them in schema_migrations
    seed.py                 # loads schema/seeds/*.json into an empty database
  schema/
    migrations/
      001_initial.sql       # every table + the append-only audit-log triggers (today's schema)
    seeds/
      defaults.json         # default settings (follow_up_hours 48, margin_floor_pct 15, AI defaults)
      aircond.json          # Sejuk Jaya: settings, products, reps, customers, deals, memories, logs
      fnb.json              # Kopi & Bakery
  models/
    requests.py             # today's request bodies (renamed from schemas.py)
    entities.py             # Product, Rep, DealItem, Deal, Customer, ClientMemory, Approval
    state.py                # Company, Pipeline, StagePipeline, StatePayload (the /api/state response)
    settings.py             # BusinessSettings (typed view of the settings table)
    enums.py                # Stage, Role, PermissionMode, DealAction (str Enums)
```

`backend/env.py` and `backend/services/profiles.py` are deleted; `backend/database.py` shrinks to the business helpers (follow-up timer, margin, commission) or moves into `backend/services/pipeline.py`.

---

## 3. Migrations / 迁移

**`001_initial.sql`** is today's schema exactly: `settings`, `products`, `reps`, `deals` (with its `CHECK` on stage), `audit_logs` + the two append-only triggers, `client_memories`, `customers`, `role_permissions`, `approval_requests`.

**Runner (`backend/db/migrate.py`, ~40 lines):**

1. Create `schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)` if missing.
2. Read `backend/schema/migrations/*.sql`, sorted by name.
3. For each file not in `schema_migrations`: run it in one transaction, insert its version, commit. Stop on the first error and report the file name.
4. Old cash & stock databases (an `invoices` table exists): drop every table and start from `001` (demo data only, as agreed).

**Rules for teammates:**
- Never edit a migration that has been pushed. Add a new numbered file instead (`002_add_rep_targets.sql`).
- Every migration change comes with the matching change in `orm.py` and `entities.py` in the same pull request.
- A test (`test_schema_matches_orm`) migrates a fresh database and checks that every ORM model's columns exist in it, so the SQL files and the models can't drift.

---

## 4. SQLAlchemy / 数据访问

- SQLAlchemy **2.0 style**: `Mapped[...]`, `mapped_column`, `select()`.
- The ORM **does not create tables** (`metadata.create_all` is never called). Tables come only from the migrations.
- `session_scope()` context manager: commit on success, roll back on error, always close. This also fixes the old problem where an error left a connection open and locked the database for the next request.
- JSON column: `deals.items_json` stays TEXT in SQL; the ORM exposes it as a list of `DealItem` via a small type.
- Every module that uses `sqlite3` or `get_db()` moves to sessions: `database.py`, `routes/deals.py`, `routes/exports.py`, `routes/team.py`, `routes/state.py`, `routes/onboarding.py`, `routes/whatsapp.py` (only what Phase 3 doesn't replace), `services/customers.py`, `services/permissions.py`, `services/memory.py`, `services/onboarding.py`.
- The audit-log rule stays in the database triggers. A `log(session, message)` helper replaces `add_log`.

---

## 5. Pydantic / 类型

| Model | Used for |
|---|---|
| `AppSettings` (`config.py`, pydantic-settings) | Everything from `.env`/environment: `DATABASE_PATH`, `LMSTUDIO_URL`, `LMSTUDIO_API_KEY`, `LMSTUDIO_MODEL`, `LMSTUDIO_VISION_MODEL`, `AI_PROVIDER`, `RUNPOD_*`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `HOST`, `PORT`. Replaces `backend/env.py` and every `os.getenv` |
| `BusinessSettings` | Typed read/write of the `settings` table: `company_name`, `sme_preset`, `framework`, `follow_up_hours: int`, `margin_floor_pct: float`, AI overrides. No more `int(get_setting(...))` with fallbacks |
| `Product`, `Rep`, `DealItem`, `Deal`, `Customer`, `ClientMemory`, `Approval` | Built from ORM rows (`model_config = from_attributes`), returned by the API |
| `StatePayload` | The `/api/state` response; `response_model` on every route that returns `state`, so FastAPI validates it and `/docs` shows the real shape |
| `Stage`, `Role`, `PermissionMode`, `DealAction` | `str` Enums instead of string literals |
| Request bodies | Today's models, with validation moved into the model (`qty >= 1`, `discount >= 0`, `commissionPct` 0–50, TIN format) via `Field` and validators, so routes stop checking by hand |

Staff vs Owner: `Product.unit_cost` and `Deal.margin_pct` are `Optional`, and the state builder leaves them `None` for Staff, with `exclude_none` on the response.

---

## 6. JSON seeds / 演示数据

`aircond.json` shape (same content as `profiles.py` today):

```json
{
  "settings": { "company_name": "Sejuk Jaya Aircond Sdn Bhd", "framework": "1. Standard installation labor: RM 250/unit. …" },
  "products": [{ "sku": "ACN-DAI-15", "name": "Daikin 1.5HP Inverter Unit", "sell_price": 1150, "unit_cost": 850 }],
  "reps":     [{ "name": "Aina", "commission_pct": 3.0 }],
  "customers": [{ "name": "Tan Bros Trading", "phone": "+60 12-345 6789", "tin": "C2088391020" }],
  "deals": [{ "id": "QT-2026-101", "customer": "Kedai Runcit Ah Seng", "rep": "Ahmad", "stage": "FOLLOW_UP",
              "items": [{ "sku": "ACN-DAI-15", "qty": 3 }], "created_hours_ago": 50, "follow_up_in_hours": -2, "follow_ups": 1 }],
  "memories": [{ "customer": "Tan Bros Trading", "tier": "VIP_FAST_PAYER", "score": 94, "style_summary": "…" }],
  "logs": ["09:00 AM · [System] Loaded Sejuk Jaya demo: 3 reps, 10 deals."]
}
```

- Times stay relative to now (`created_hours_ago`, `follow_up_in_hours`, `won_hours_ago`) so follow-ups are live on every reset.
- Amounts are **not** stored in the seed; the seeder prices items from `products`, as today.
- The seed files are validated by Pydantic models (`SeedFile`), so a typo in a teammate's edit fails with a clear message instead of a half-seeded database.
- The list of demo businesses comes from the files in `seeds/` (`PROFILE_NAMES` is gone).

---

## 7. What stays in Python / 哪些仍留在代码里

To keep "no hardcoding" sensible, **data** moves to files; **rules** stay in code:

| Moves to files | Stays in code (as Enums or constants with a reason) |
|---|---|
| Table definitions, demo data, default settings | Stage names and the stage flow (`Stage` enum) |
| | Permission catalogue (`ACTIONS`, `OWNER_ONLY`, `MANDATORY_RULES`): these are rules the backend enforces, reviewed in code |
| | CSV column list (it's the export contract with the accountant, covered by a test) |

If the team wants the permission labels or the quote disclaimer editable without code, that's a later `002` migration plus a settings row.

---

## 8. Steps / 步骤 (~6–7h, one person, before Phase 3)

| # | Step | Done when |
|---|---|---|
| 1 | Add `sqlalchemy>=2.0` to `requirements.txt` (`pydantic-settings` is already installed; add it too). `config.py` with `AppSettings`; delete `env.py` | Server starts; `.env` values load; tests set `DATABASE_PATH` instead of patching `database.DB_PATH` |
| 2 | `schema/migrations/001_initial.sql`, `db/migrate.py`, `db/engine.py` | Fresh DB has every table + triggers; second start applies nothing; old `invoices` DB is rebuilt |
| 3 | `db/orm.py` + `test_schema_matches_orm` | ORM and migrated DB match |
| 4 | `schema/seeds/*.json`, `db/seed.py`, `SeedFile` models; delete `services/profiles.py` | `/api/reset` and `/api/profile` give the same demo data as today |
| 5 | `models/enums.py`, `entities.py`, `state.py`, `settings.py`; rename `schemas.py` → `requests.py` with validators | `/api/state` uses `response_model=StatePayload`; `/docs` shows typed models |
| 6 | Move every query to sessions, file by file (list in section 4); delete `get_db()` | No `import sqlite3` left outside `db/` and the audit-log test |
| 7 | Run all tests + localhost flow (quote → discount → approval → won → CSV) | Same 59 tests pass as before (6 WhatsApp tests still wait for Phase 3); responses identical except typed |
| 8 | Update doc 11 (sections 1, 2 and 4 refer to the new files), commit, ask before pushing | |

**Behaviour does not change.** Every existing test must pass unchanged except where it imports moved modules (`conftest.py`, `test_pipeline.py`, `test_onboarding.py`).

---

## 9. Risks / 风险

| Risk | Mitigation |
|---|---|
| Big diff right before the hackathon | One step at a time, tests after each step; behaviour frozen |
| Conflicts with teammates already working on Phase 5 (webapp) | Backend only; the `/api/state` JSON keeps the same field names (camelCase via Pydantic aliases) |
| ORM and SQL files drift apart | `test_schema_matches_orm` |
| A teammate edits a pushed migration | Rule in section 3; the runner could also store a checksum and refuse changed files (add if it happens) |
