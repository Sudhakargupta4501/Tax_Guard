# TaxGuard AI
### AI-Based Income Tax Fraud Detection and Smart Billing Management System

> **Academic project disclaimer.** TaxGuard AI is an *educational* billing and fraud-risk detection system built for a Full Stack Web Development course. It does **not** replace professional tax advice, a certified GST/e-invoicing system, or any decision of a tax authority. Tax calculations use simplified assumptions (see [Limitations](#17-limitations)). Fraud alerts are **leads for human review**, never findings of fraud. All demo data is synthetic.

---

## 1. Overview
TaxGuard AI is a MERN application (MongoDB Atlas, Express, React, Node) with two modules:

* **Module A – Smart Billing:** customers, products, configurable GST rates, invoices with server-side decimal-safe calculation, PDF invoices, payments, outstanding balances, sales/tax reports, audit trail.
* **Module B – Fraud-Risk Detection:** an explainable, rule-based engine (plus an optional Python Isolation Forest service) that raises alerts for human reviewers with a documented 0–100 risk score, a review workflow and a full history.

## 2. Problem statement
Small businesses produce invoices, payments and tax figures in many places, and errors or manipulation (duplicates, wrong totals, mis-computed tax, unreconciled sales) are hard to spot manually. Reviewers need one system that records billing data correctly *and* highlights records that deserve a closer look, with clear reasons.

## 3. Objectives
1. Provide a complete, validated billing workflow with correct, reproducible money and GST arithmetic.
2. Detect and explain suspicious patterns without declaring fraud automatically.
3. Give reviewers a controlled workflow (comment, status, resolution notes) with an audit trail.
4. Apply sound security practice (RBAC, HTTP-only cookie auth, CSRF, validation, rate limiting).

## 4. Main features
| Area | Implemented |
|---|---|
| Auth | Register (never as admin), login, logout, `/me`, bcrypt hashing, JWT in HTTP-only cookie + CSRF token, rate-limited |
| RBAC | Four roles (Admin, Business Owner, Accountant, Reviewer) enforced on the **backend**; the UI only mirrors it |
| Customers / Products | CRUD, search, archive instead of delete when invoices exist, GSTIN format + state-code checks, inventory option |
| Tax | Configurable `TaxConfiguration` (rate, category, effective date, active), CGST+SGST (intra-state) vs IGST (inter-state), integer-paise arithmetic, round-half-up |
| Invoices | Multi-line, per-line discount, unique sequential numbers, server recalculation, update rules + audit, cancel, PDF (PDFKit) |
| Payments | Append-only, partial payments, over-payment prevention, idempotency key against duplicate submits, refunds; manual entries are labelled as *manually recorded*, not bank-verified |
| Fraud | 9 rule categories + optional ML indicator, configurable thresholds, alert lifecycle New → Under Review → Resolved / False Positive, comments, history |
| Reports | Dashboard summary, sales, tax by category/period, discrepancies, reconciliation, CSV export |
| UI | 12 pages, role-based sidebar, Recharts dashboards, React Hook Form + Zod, responsive (mobile drawer, scrollable tables), loading / empty / error states |
| Audit | Append-only audit log of important billing, tax, user and review actions (no passwords/tokens logged) |

## 5. Technology stack
Frontend: HTML5, CSS3, JavaScript ES6+, React 18, Vite, Tailwind CSS, React Router DOM, Fetch API, Hooks (`useState/useEffect/useContext/useMemo/useCallback/useRef`), Context API, Recharts, React Hook Form + Zod, Lucide React.
Backend: Node.js, Express, REST, Mongoose, MongoDB (Atlas), JWT, bcryptjs, Helmet, express-rate-limit, CORS, Zod validation, PDFKit, dotenv.
Optional ML: Python, FastAPI, Pandas, NumPy, scikit-learn (Isolation Forest).
Testing: Node's built-in test runner + Supertest (server), Vitest + React Testing Library (client), `unittest` (ML service).

## 6. System architecture
```
 React SPA (Vite, :5173) ──fetch /api (cookie + X-CSRF-Token)──▶ Express API (:5000)
                                                                   │ routes → validators(Zod) → controllers → services → Mongoose models
                                                                   │            auth/RBAC, rate limit, helmet, CORS, error handler
                                                                   ├──▶ MongoDB Atlas
                                                                   └──▶ (optional) FastAPI ML service (:8000)  – failure never breaks the core app
```
Server layout: `config/ models/ routes/ controllers/ services/ middleware/ validators/ utils/ scripts/ tests/`. Business logic lives in services (`taxService`, `invoiceService`, `paymentService`, `fraudRules`, `fraudDetectionService`, `reportService`, `pdfService`).

## 7. Database design
Required models: `User`, `Customer`, `Product`, `Invoice`, `Payment`, `FraudAlert`, `AuditLog`, `TaxConfiguration`. Supporting models: `Counter` (invoice/alert numbering), `Setting` (business profile, fraud thresholds), `TransactionRecord` (externally supplied transaction/sales records used for reconciliation).
Key relations: Invoice → Customer, Payment → Invoice, FraudAlert → Invoice / Customer / reviewer (User), AuditLog → User. Invoice numbers are globally unique (one business per deployment); customer e-mail, payment idempotency key and others have unique partial indexes; search fields are indexed. Money is stored as decimal values computed in integer paise.

## 8. API documentation
All JSON responses are `{ success, data?, message?, errors?, pagination? }`. Everything except register/login/logout requires the session cookie; state-changing requests also need `X-CSRF-Token`.

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/auth/register` · `/login` · `/logout` | Public self-registration (non-admin role) / sign in / sign out |
| GET / PATCH | `/api/auth/me` | Profile |
| GET POST | `/api/customers` · GET PUT DELETE `/api/customers/:id` | Customers (deleting a customer that has invoices archives it instead) |
| GET POST | `/api/products` · GET PUT DELETE `/api/products/:id` | Products |
| GET POST | `/api/invoices` · GET PUT `/api/invoices/:id` · GET `/api/invoices/:id/pdf` | Invoices (pagination, filters) |
| GET POST | `/api/payments` · GET `/api/payments/:id` | Payments (append-only) |
| GET | `/api/fraud-alerts` · `/meta` · `/transactions` · `/:id` | Alerts and supplied transactions |
| POST | `/api/fraud-alerts/analyze` · `/transactions` | Run analysis · import transaction records |
| PATCH | `/api/fraud-alerts/:id/review` | Status, comment, resolution notes |
| GET | `/api/reports/summary` · `/sales` · `/tax` · `/fraud` | Reports (date-range query) |
| GET | `/api/audit-logs` | Read-only audit trail |
| GET POST PUT | `/api/tax-config` | Tax configuration (admin writes) |
| GET PATCH | `/api/users` | User/role management (admin) |
| GET PUT | `/api/settings/business` · `/api/settings/fraud-thresholds` | Settings |
| GET | `/api/health` | Liveness |

### Role permissions
| Capability | Admin | Business Owner | Accountant | Reviewer |
|---|:-:|:-:|:-:|:-:|
| Read customers/products/invoices/payments/reports | ✔ | ✔ | ✔ | ✔ |
| Create/edit customers, products, invoices, payments | ✔ | ✔ | ✔ | – |
| Archive customers/products, cancel invoices | ✔ | ✔ | – | – |
| Run fraud analysis | ✔ | ✔ | – | ✔ |
| Review alerts (status/comments) | ✔ | – | – | ✔ |
| Import transaction records | ✔ | ✔ | ✔ | – |
| View audit logs | ✔ | ✔ | – | ✔ |
| Tax configuration, settings, user roles | ✔ | – | – | – |

## 9. Installation
**Requirements:** Node.js ≥ 18.17 (22 tested for syntax checks), npm ≥ 9, a MongoDB Atlas account, optionally Python ≥ 3.10.
```bash
npm run install:all        # installs root, server and client dependencies
cp server/.env.example server/.env      # then edit (see below)
cp client/.env.example client/.env      # optional in development
```

## 10. MongoDB Atlas setup
1. Create a free cluster at <https://cloud.mongodb.com>.
2. *Database Access* → add a database user with a strong password (read/write on one database).
3. *Network Access* → add your IP (use a restricted list in production, not `0.0.0.0/0`).
4. *Connect → Drivers* → copy the connection string, e.g. `mongodb+srv://<user>:<password>@<cluster>/taxguard?retryWrites=true&w=majority`, and put it in `server/.env` as `MONGODB_URI`. URL-encode special characters in the password. Never commit `.env`.

## 11. Environment variables
`server/.env.example` contains placeholders only. Required: `MONGODB_URI`, `JWT_SECRET` (≥ 16 chars; generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`). The server validates the environment at startup and prints a clear error when something is missing. Others: `PORT`, `JWT_EXPIRES_IN`, `CLIENT_URL` (comma-separated allowed origins), `BUSINESS_NAME`, `BUSINESS_STATE_CODE`, `DEFAULT_CURRENCY`, `ML_SERVICE_URL` (optional), `COOKIE_SAMESITE`, `TRUST_PROXY`, `ALLOW_PUBLIC_REGISTRATION`. Frontend: `VITE_API_URL` (default `/api`, proxied by Vite in development).

## 12. Run the project
```bash
# 1) create the first administrator securely (no hard-coded credentials)
cd server
ADMIN_NAME="Your Name" ADMIN_EMAIL="you@example.com" ADMIN_PASSWORD="Str0ngPassw0rd" npm run create-admin

# 2) OPTIONAL: synthetic demo data (development databases only)
SEED_PASSWORD="Demo-Passw0rd" npm run seed        # add --reset to wipe and re-seed
# demo users: admin@/owner@/accountant@/reviewer@demo.taxguard.test (password = your SEED_PASSWORD)

# 3) start API + web together from the project root
cd .. && npm run dev        # API http://localhost:5000, web http://localhost:5173
```
The seed deliberately contains normal invoices plus: an incorrect total, a tax discrepancy, a duplicate invoice, a repeated external reference, an unusual amount, repeated refunds and unreconciled monthly sales, then runs the analysis. Everything is labelled synthetic.

Optional ML service: see `ml-service/README.md`, then set `ML_SERVICE_URL=http://localhost:8000`. The core app runs fine without it.

## 13. Tests
```bash
npm test                   # server + client
npm run test:server        # unit + integration (Node test runner + Supertest)
npm run test:client        # Vitest + React Testing Library
python ml-service/tests/test_scoring.py
```
Server integration tests start an in-memory MongoDB (`mongodb-memory-server`, which downloads a MongoDB binary on first use). To use your own **throw-away** database instead set `TEST_MONGODB_URI` – the test run **drops that database**, so never point it at real data. Note: the course brief mentions Jest; this project uses Node's built-in test runner (`node:test`) with Supertest instead, to avoid an extra dependency.

Production build: `npm run build` (outputs `client/dist`; in production the Express server also serves it).

## 14. Fraud detection methodology
**Stage 1 – rules** (`server/services/fraudRules.js`, version `rules-v1.0.0`), each returning an explanation and evidence:
`DUPLICATE_INVOICE`, `INCORRECT_TOTAL`, `TAX_DISCREPANCY`, `MISSING_INFO`, `UNUSUAL_AMOUNT` (modified z-score using median/MAD, requires minimum history), `REPEATED_REFUND`, `SUSPICIOUS_FREQUENCY`, `SALES_RECONCILIATION`, `POTENTIAL_UNDER_REPORTING` (only when supplied comparison data exists).
**Score:** `riskScore = clamp(base weight of the rule + magnitude adjustment + corroboration, 0, 100)`. Corroboration adds a small bonus (capped) for each *other distinct category* on the same invoice, so one underlying issue is not counted twice. A lone statistical outlier is never escalated above Low. Severity: Low < 35 ≤ Medium < 65 ≤ High. All thresholds and weights are configurable (Settings → fraud thresholds) and are **illustrative until tuned on representative data**. The score is a prioritisation indicator, **not a probability of fraud**.
**Lifecycle:** re-running analysis recalculates open alerts in place, never overrides a reviewer's decision, and does not re-raise a reviewed alert with identical evidence. Alerts are never deleted through the UI/API.
**Stage 2 – ML (optional):** Isolation Forest (scikit-learn) behind FastAPI, fitted on the submitted batch, unsupervised. No labelled data exists, so **no accuracy/precision/recall is reported or claimed**. Output is shown as a relative indicator only.

## 15. Screenshots
_Add your own screenshots after running the app (Dashboard, Create Invoice, Fraud Detection, Alert modal, Tax Reports)._

## 16. Security considerations
bcrypt password hashing · JWT in an HTTP-only, SameSite cookie (Secure in production) with an HMAC-derived CSRF token kept only in memory · RBAC on every route · Zod validation of body/query/params on the server (independent of the client schemas) · ObjectId validation · mass-assignment avoided by whitelisting fields · Helmet · CORS allow-list · rate limits on auth and sensitive endpoints · append-only payments and audit logs · centralised error handler that hides stack traces in production · secrets only in environment variables · public registration cannot create admins. Use HTTPS and a restricted Atlas IP list in production.

## 17. Limitations
* GST logic is simplified (rate slabs by tax category, CGST/SGST vs IGST by state code). No e-invoicing/IRN, reverse charge, cess, TCS/TDS, composition scheme, HSN-wise rules or return filing. Default slab values are illustrative; verify against official sources.
* Reports show *recorded* tax, not independently verified liability.
* Payments are manually entered and are not bank-verified.
* One business per deployment; invoice numbers are globally unique.
* Fraud thresholds are untuned defaults; the ML component is unevaluated.
* **Verification status of this delivery:** the code was written and statically checked (all server and client files parse; imports resolve; the 22 server unit tests for money/tax/fraud-rule logic and the 4 ML scoring tests pass). The full-stack pieces – `npm install`, server integration tests (need MongoDB), client Vitest suite, `vite build`, and the FastAPI wrapper – could **not be executed** in the environment where this project was produced (package registry access was blocked). Run `npm run install:all && npm test` on your machine and fix anything that surfaces before submitting.

## 18. Future enhancements
GST return exports (GSTR-style), e-invoicing integration, multi-business tenancy, bank-statement import with verified reconciliation, labelled-data-based model evaluation and calibration, e-mail notifications, refresh-token rotation, Docker/CI pipeline.

## 19. Academic disclaimer
Prepared for academic evaluation only. Synthetic data only. Not tax, legal or financial advice; not an official compliance tool.
