# Worknoon Refund Engine

An AI-powered customer support refund evaluation system that pairs deterministic business policy rules with an LLM evaluation layer to process, audit, and explain refund requests across customer-facing and administrative interfaces.

## Demo Walkthrough

- **Video Demo Walkthrough**: [Watch the 4-Minute Walkthrough](https://www.loom.com/share/7ff968ecd338426394d5cb6f55a7e643)

---

## Overview

Worknoon Refund Engine automates the evaluation of customer return and refund requests. Rather than delegating policy compliance to an unpredictable language model, the system uses a two-tier evaluation architecture:

1. **Deterministic Policy Engine**: Enforces strict, non-negotiable business constraints (final-sale restrictions, 30-day return windows, and high-value limits) in pure TypeScript code.
2. **AI Analysis Service**: When an order satisfies all deterministic requirements, an LLM evaluates the customer's explanation against trusted order details to classify the issue, detect discrepancies or suspected fraud, sanitize responses, and generate customer-friendly messages.

The application includes two web interfaces:
- **Customer Refund Portal** (`/`): A guided self-service flow for selecting orders, specifying return reasons, and receiving immediate refund decisions.
- **Admin Dashboard** (`/admin`): An operations interface displaying evaluation history, decisions, triggered rule sets, LLM reasoning, and audit logs.

---

## Features

- **Two-Tier Decision Engine**: Separates hard business policy from semantic context analysis.
- **Fail-Safe Architecture**: If external AI services fail, time out, or produce malformed output, the system fails safe to `ESCALATED` for human review rather than defaulting to approval.
- **Prompt Injection Defense**: Defense-in-depth security combining clear prompt boundaries with deterministic regex override detection to neutralize instruction-injection attacks.
- **Immutable Audit Logging**: Every evaluation persists the final decision (`APPROVED`, `DENIED`, or `ESCALATED`), triggered rule IDs, internal reasoning, and the exact customer-facing message.
- **Customer Portal**: Interactive multi-step form with customer switcher, order selection, item breakdown, and instant resolution display.
- **Admin Dashboard**: Live request table with decision status badges, request timestamps, and detailed audit inspect drawer.
- **One-Command Reproducibility**: Complete Docker Compose setup orchestrating PostgreSQL, automatic Prisma schema migrations, seed fixtures, backend Express API, and frontend preview.

---

## Architecture

The application is structured as a decoupled full-stack monorepo:

```
worknoon-refund-engine/
├── client/                     # Frontend Single Page Application (SPA)
│   ├── src/
│   │   ├── components/
│   │   │   ├── RefundSupport.vue   # Customer refund submission portal
│   │   │   └── AdminDashboard.vue  # Support admin audit history dashboard
│   │   ├── services/
│   │   │   └── api.ts              # Typed fetch API client
│   │   ├── App.vue                 # Top navigation and layout shell
│   │   ├── main.ts                 # Vue Router configuration (/ and /admin)
│   │   ├── style.css               # Tailwind CSS 4 styles
│   │   └── types.ts                # Shared TypeScript interfaces
│   ├── Dockerfile
│   └── vite.config.ts
├── server/                     # Backend REST API and Evaluation Engine
│   ├── prisma/
│   │   ├── schema.prisma           # Relational schema (PostgreSQL)
│   │   ├── migrations/             # Versioned SQL migrations
│   │   └── seed.ts                 # Idempotent fixture database seeder
│   ├── src/
│   │   ├── services/
│   │   │   ├── policyEngine.ts     # Pure deterministic policy logic
│   │   │   ├── aiService.ts        # OpenAI / OpenRouter client & sanitizers
│   │   │   ├── refundOrchestrator.ts # Coordinates policy, AI, & fail-safes
│   │   │   └── refundPersistence.ts  # Database persistence for requests & audit
│   │   ├── index.ts                # Express application and route handlers
│   │   └── index.test.ts           # Route-level integration test suite
│   ├── .env.example                # Backend environment template
│   └── Dockerfile
├── docker-compose.yml          # Container orchestration definition
└── .env.example                # Root environment template
```

---

## Tech Stack

### Frontend (`client/`)
- **Framework**: Vue 3 (Composition API, `<script setup>`)
- **Build Tool**: Vite 8
- **Language**: TypeScript 5
- **Styling**: Tailwind CSS 4 (`@tailwindcss/vite`)
- **Routing**: Vue Router 4 (HTML5 history mode)

### Backend (`server/`)
- **Runtime**: Node.js (ES Modules)
- **Framework**: Express 5
- **Language**: TypeScript 5
- **Database & ORM**: PostgreSQL 16, Prisma ORM 5
- **Validation**: Zod 4
- **AI Integration**: OpenAI SDK 7 (OpenRouter compatible)
- **Testing**: Node.js built-in test runner (`node --test`) via `tsx`

### Infrastructure
- **Containerization**: Docker, Docker Compose
- **Images**: `postgres:16-alpine`, `node:20-alpine`

---

## System Flow

```mermaid
flowchart TD
    A[Customer submits Refund Request] --> B[Zod Input Validation]
    B --> C[Fetch Order & Customer from DB]
    C --> D[Run Policy Engine evaluateRefund]

    D -->|Final sale or Expired >30 days| E[DENIED: Policy Short-Circuit]
    D -->|Order total >$500| F[ESCALATED: High-Value Short-Circuit]
    D -->|Within 30 days & <=$500 & not final sale| G[Eligible for AI Evaluation]

    G --> H[OpenAI / OpenRouter Analysis]
    H -->|API Error / Timeout / Malformed| I[ESCALATED: Fail-Safe]
    H -->|Prompt Injection / Discrepancy / Suspicious| J[ESCALATED: Suspicious Flagged]
    H -->|Valid Claim & No Discrepancies| K[APPROVED: Legitimate Claim]

    E --> L[Persist RefundRequest & AuditLog]
    F --> L
    I --> L
    J --> L
    K --> L
    L --> M[Return JSON Response to Client]
```

1. **Input Validation**: Request payload (`orderId`, `reasonCategory`, `customerStatement`) validated with Zod.
2. **Data Retrieval**: Order details, line items, and customer information loaded from PostgreSQL.
3. **Deterministic Evaluation**:
   - If an order or any line item is `isFinalSale: true` -> **DENIED** (`FINAL_SALE`).
   - If purchase date is older than 30 days (`purchaseDate < now - 30 days`) -> **DENIED** (`REFUND_WINDOW_EXPIRED`).
   - If order total exceeds $500 (`totalAmount > 500.00`) -> **ESCALATED** (`REFUND_AMOUNT_OVER_LIMIT`).
   - Final-sale and expiration take precedence over high-value escalation.
   - If a hard constraint is met, the system **short-circuits immediately** without invoking the LLM.
4. **AI Evaluation**:
   - Orders of exactly $500 or less that meet policy rules proceed to AI analysis.
   - The LLM parses untrusted customer statements against trusted order context.
   - Deterministic regex screening intercepts instruction-override patterns (`ignore all instructions`, `system override`).
   - Any AI failure (network error, timeout, unparseable response) fails safe to **ESCALATED** (`AI_ANALYSIS_FAILED`).
5. **Persistence**: The orchestrator saves the `RefundRequest` record and an associated `AuditLog` inside a database transaction.
6. **Response**: Final status, customer-facing message, reasoning, and rule identifiers are returned to the client.

---

## Refund Policy

The policy engine and orchestrator enforce the following evaluation rules:

### Deterministic Policy Rules (`policyEngine.ts`)
| Rule Code | Description | Threshold / Condition | Result |
| :--- | :--- | :--- | :--- |
| `FINAL_SALE` | Order or any item is marked final sale | `order.isFinalSale = true` OR item `isFinalSale = true` | `DENIED` |
| `REFUND_WINDOW_EXPIRED` | Order was purchased outside return window | `purchaseDate < now - 30 days` | `DENIED` |
| `REFUND_AMOUNT_OVER_LIMIT` | High-value order requiring human authorization | `totalAmount > $500.00` | `ESCALATED` |

> Orders of exactly $500.00 (`totalAmount = 500.00`) do not trip `REFUND_AMOUNT_OVER_LIMIT` and proceed directly to AI evaluation with no hard constraint rules triggered. (Static seed fixtures include descriptive audit labels such as `ORDER_AT_500_DOLLARS`, `DELIVERED_ORDER`, and `WITHIN_30_DAYS`).

### Orchestration Rules (`refundOrchestrator.ts`)
| Rule Code | Description | Condition | Result |
| :--- | :--- | :--- | :--- |
| `AI_FLAGGED_SUSPICIOUS` | Statement contains conflicts, prompt injection, or fraud indicators | Model flags `suspicious: true` OR `isInstructionOverride()` matches | `ESCALATED` |
| `AI_ANALYSIS_FAILED` | Upstream AI service unreachable, timed out, or invalid | API failure / timeout / bad format | `ESCALATED` (Fail-Safe) |

---

## AI Integration

- **Model**: `nvidia/nemotron-3-super-120b-a12b:free` (configurable via `OPENAI_MODEL`).
- **Endpoint**: OpenRouter API (`https://openrouter.ai/api/v1`) or any OpenAI-compatible API base URL (`OPENAI_BASE_URL`).
- **Structured Outputs**: Uses `response_format` JSON Schema mode (`json_schema` with `strict: true`) requiring four fields:
  - `classification`: Category classification (`DAMAGED_ITEM`, `INCORRECT_ITEM`, `BUYERS_REMORSE`, `LATE_DELIVERY`, `FRAUD_SUSPECTED`, `OTHER`).
  - `suspicious`: Boolean flag indicating instruction overrides, contradictory statements, or fraud indicators.
  - `reasoning`: Technical rationale explaining how the claim compares against trusted order facts.
  - `customerMessage`: Courteous, user-facing message explaining the decision.
- **Message Sanitization**:
  - Automatically cleans internal jargon (strips references to `"AI team"`, `"AI review"`, `"eligible for AI review"`).
  - Guarantees that suspicious or escalated claims never show an approval message to the customer.

---

## Prompt Injection Protection

The system implements defense-in-depth against prompt injection, jailbreaking, and instruction-override attacks:

1. **Clear Trust Boundaries**:
   - Trusted database context and untrusted customer text are strictly separated in prompt formatting using boundary tags:
     ```
     TRUSTED APPLICATION CONTEXT
     { ... }
     END TRUSTED APPLICATION CONTEXT

     UNTRUSTED CUSTOMER CONTENT
     ---BEGIN UNTRUSTED CUSTOMER CONTENT---
     { customerStatement }
     ---END UNTRUSTED CUSTOMER CONTENT---
     ```
2. **System Prompt Hardening**:
   - Explicit instructions declare customer text as untrusted data that must never be followed as system instructions.
3. **Deterministic Regex Override Detector** (`isInstructionOverride`):
   - Scans statements for command-override patterns:
     - `ignore (all) (previous/prior/above) instructions`
     - `system override`
     - `override (the) (refund/final-sale) policy`
     - `bypass (the) policy/rules`
     - `developer mode`
     - `reveal/show system prompt`
   - If an instruction-override attempt is detected, `suspicious: true` is unconditionally enforced in application code, overriding any potential false-negative returned by the model.
4. **Policy Precedence**:
   - Final-sale and expired orders are short-circuited before the LLM is ever called. A prompt injection cannot trigger an approval on an ineligible order because the model is never invoked.

---

## Database Schema

Defined in [`server/prisma/schema.prisma`](file:///c:/MyCode/worknoon-refund-engine/server/prisma/schema.prisma):

### Enums
- `OrderStatus`: `DELIVERED`, `IN_TRANSIT`, `CANCELLED`
- `DecisionStatus`: `APPROVED`, `DENIED`, `ESCALATED`
- `RefundReasonCategory`: `DAMAGED_ITEM`, `INCORRECT_ITEM`, `BUYERS_REMORSE`, `LATE_DELIVERY`, `FRAUD_SUSPECTED`, `OTHER`

### Models & Relations
- **Customer**:
  - `id` (UUID, primary key)
  - `email` (String, unique)
  - `name` (String)
  - `createdAt` (DateTime)
  - Relations: has many `Order`, has many `RefundRequest`
- **Order**:
  - `id` (UUID, primary key)
  - `orderNumber` (String, unique)
  - `customerId` (UUID, foreign key -> Customer)
  - `totalAmount` (Decimal 10,2)
  - `isFinalSale` (Boolean, default: false)
  - `status` (OrderStatus, default: DELIVERED)
  - `purchaseDate` (DateTime)
  - `deliveredDate` (DateTime, optional)
  - Relations: belongs to `Customer`, has many `OrderItem`, has many `RefundRequest`
- **OrderItem**:
  - `id` (UUID, primary key)
  - `orderId` (UUID, foreign key -> Order)
  - `productName` (String)
  - `sku` (String)
  - `unitPrice` (Decimal 10,2)
  - `quantity` (Int, default: 1)
  - `isFinalSale` (Boolean, default: false)
- **RefundRequest**:
  - `id` (UUID, primary key)
  - `orderId` (UUID, foreign key -> Order)
  - `customerId` (UUID, foreign key -> Customer)
  - `reasonCategory` (RefundReasonCategory)
  - `customerStatement` (Text)
  - `status` (DecisionStatus)
  - `createdAt` (DateTime)
  - Relations: belongs to `Order`, belongs to `Customer`, has one `AuditLog`
- **AuditLog**:
  - `id` (UUID, primary key)
  - `refundRequestId` (UUID, foreign key -> RefundRequest, unique)
  - `decision` (DecisionStatus)
  - `rulesTriggered` (String array)
  - `aiReasoning` (Text)
  - `customerMessage` (Text)
  - `createdAt` (DateTime)

---

## API Endpoints

### `GET /health`
Liveness check returning service health.
- **Response**: `200 OK`
  ```json
  { "status": "ok" }
  ```

### `GET /api/customers`
Fetches all customers and their associated orders sorted by customer name.
- **Response**: `200 OK`
  ```json
  [
    {
      "id": "c001...",
      "name": "Maya Patel",
      "email": "maya.patel@example.com",
      "orders": [
        {
          "id": "o001...",
          "orderNumber": "WN-1001",
          "totalAmount": "129.00",
          "status": "DELIVERED",
          "purchaseDate": "2026-09-12T12:00:00.000Z",
          "deliveredDate": "2026-09-15T12:00:00.000Z",
          "isFinalSale": false
        }
      ]
    }
  ]
  ```

### `GET /api/orders/:id`
Fetches a single order by UUID including line items and customer details.
- **Path Parameter**: `id` (UUID)
- **Response**: `200 OK` or `404 Not Found`

### `POST /api/refunds/evaluate`
Submits a refund request for policy and AI evaluation, persisting the outcome and audit log.
- **Request Body**:
  ```json
  {
    "orderId": "b88ff761-b566-40c9-b5ba-cbf759aa7798",
    "reasonCategory": "DAMAGED_ITEM",
    "customerStatement": "The mug handle was cracked on arrival."
  }
  ```
- **Validation**:
  - `orderId`: valid UUID string
  - `reasonCategory`: valid `RefundReasonCategory` enum
  - `customerStatement`: non-empty trimmed string
- **Response**: `200 OK`
  ```json
  {
    "refundRequestId": "bacdd3be-5d0e-416e-af61-ac705c98fd03",
    "status": "APPROVED",
    "rulesTriggered": [],
    "aiReasoning": "Customer statement matches item in order. No discrepancies noted.",
    "customerMessage": "Your refund request has been approved."
  }
  ```
  *(Note: `rulesTriggered` is empty for clean approvals. If a constraint or flag is triggered, it contains the applicable rule codes such as `["FINAL_SALE"]`, `["REFUND_AMOUNT_OVER_LIMIT"]`, or `["AI_FLAGGED_SUSPICIOUS"]`).*

### `GET /api/admin/requests`
Fetches all historical refund requests ordered by creation date descending.
- **Response**: `200 OK`
  ```json
  [
    {
      "id": "bacdd3be...",
      "orderId": "b88ff761...",
      "customerId": "c001...",
      "reasonCategory": "DAMAGED_ITEM",
      "customerStatement": "The mug handle was cracked on arrival.",
      "status": "APPROVED",
      "createdAt": "2026-09-25T15:10:50.000Z",
      "order": { "id": "...", "orderNumber": "WN-1002" },
      "customer": { "id": "...", "name": "Ethan Brooks", "email": "ethan.brooks@example.com" },
      "auditLog": {
        "id": "...",
        "decision": "APPROVED",
        "rulesTriggered": ["DELIVERED_ORDER"],
        "aiReasoning": "...",
        "customerMessage": "..."
      }
    }
  ]
  ```
  *(Note: Pre-seeded mock fixtures in `seed.ts` include descriptive baseline audit labels like `DELIVERED_ORDER`, `WITHIN_30_DAYS`, and `ORDER_AT_500_DOLLARS`).*

### `GET /api/admin/requests/:id`
Fetches a single refund request and its audit log by UUID.
- **Path Parameter**: `id` (UUID)
- **Response**: `200 OK` or `404 Not Found`

---

## Environment Variables

| Variable | Location | Description | Default / Example |
| :--- | :--- | :--- | :--- |
| `PORT` | Server / Root | Port for the Express backend server | `5000` |
| `DATABASE_URL` | Server / Root | PostgreSQL database connection string | `postgresql://postgres:postgres@localhost:5432/refund_system?schema=public` |
| `OPENAI_BASE_URL` | Server / Root | Base URL for OpenAI-compatible endpoint | `https://openrouter.ai/api/v1` |
| `OPENAI_API_KEY` | Server / Root | API key for OpenAI / OpenRouter authentication | Required for AI evaluation |
| `OPENAI_MODEL` | Server / Root | Language model identifier | `nvidia/nemotron-3-super-120b-a12b:free` |
| `VITE_API_URL` | Client | Optional base URL for API calls from browser | `""` (uses same-origin relative `/api`) |
| `VITE_PROXY_TARGET` | Client | Target host for Vite dev/preview `/api` reverse proxy | `http://localhost:5000` (local) / `http://backend:5000` (Docker) |

---

## Local Development

### Prerequisites
- Node.js 20+
- PostgreSQL 16+ running locally on port 5432 (or via Docker)
- OpenRouter or OpenAI API key

### 1. Database Setup
Start a PostgreSQL container if not running locally:
```bash
docker run --name worknoon-postgres -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=refund_system -p 5432:5432 -d postgres:16-alpine
```

### 2. Backend Setup
```bash
cd server

# Copy environment configuration
cp .env.example .env
# Edit .env with your OPENAI_API_KEY

# Install dependencies
npm install

# Run database migrations and generate Prisma client
npx prisma migrate dev

# Seed database with mock customers, orders, and refund requests
npm run db:seed

# Start backend dev server with hot reload
npm run dev
```
Backend runs at `http://localhost:5000`.

### 3. Frontend Setup
```bash
cd ../client

# Install dependencies
npm install

# Start Vite dev server
npm run dev
```
Frontend runs at `http://localhost:5173`.
- Customer Portal: `http://localhost:5173/`
- Admin Dashboard: `http://localhost:5173/admin`

---

## Docker Setup

The entire stack is configured to run reproducibly via Docker Compose:

```bash
docker compose up --build
```

### Startup Dependency Flow
```
PostgreSQL (healthy) ➔ Prisma Migrations (deploy) ➔ Mock Seed (db:seed) ➔ Express Backend (healthy) ➔ Frontend Preview
```

1. **`postgres`**: Launches PostgreSQL 16 on port 5432 with health check `pg_isready`.
2. **`backend`**: Waits for PostgreSQL to become healthy, runs `npx prisma migrate deploy`, seeds database fixtures with `npm run db:seed`, and launches Express on port 5000 with a `/health` probe.
3. **`frontend`**: Waits for backend to become healthy, serves production build via Vite preview on port 5173, and proxies `/api` requests to `http://backend:5000`.

To stop the services and remove containers:
```bash
docker compose down
```
To remove volumes and start from a completely clean state:
```bash
docker compose down -v
```

---

## Seed Data

The seed script (`server/prisma/seed.ts`) generates realistic mock fixtures:

- **15 Customers**: Diverse names and email addresses.
- **30 Orders**: Ranging across standard and specialized testing scenarios:
  - `WN-1001`: Eligible order (Linen Overshirt & Wool Scarf, $129.00).
  - `WN-1002`: Eligible order (Ceramic Travel Mug, $34.00).
  - `WN-1003`: Final-sale order (`isFinalSale: true`, $78.00).
  - `WN-1004`: Expired order (delivered >30 days ago).
  - `WN-1005`: Recent order (delivered within 30 days).
  - `WN-1006`: High-value order (Espresso Machine, $620.00 > $500).
  - `WN-1007`: Mixed items order containing one final-sale item.
  - `WN-1008`: Final-sale order with prompt injection text.
  - `WN-1009`: Borderline high-value order (Total exactly $500.00).
  - `WN-1010`: Expired order (delivered >30 days ago).
  - `WN-1011` to `WN-1030`: Standard delivered orders ($84.00 total).
- **8 Historical Refund Requests**: Pre-seeded with complete `AuditLog` records spanning `APPROVED`, `DENIED`, and `ESCALATED` outcomes.

---

## Testing

The backend includes an automated test suite verifying policy rules, AI integration, prompt injection handling, orchestration fail-safes, and persistence.

Run the test suite:
```bash
cd server
npm test
```

### Test Coverage (`58 tests, 13 suites, 0 failures`)
1. **`policyEngine.test.ts`**:
   - Denies orders with final sale items.
   - Denies orders purchased >30 days ago.
   - Escalates orders over $500.
   - Allows orders of exactly $500 to proceed to AI.
   - Prioritizes denial over escalation when both apply.
2. **`aiService.test.ts`**:
   - Parses structured LLM responses.
   - Detects instruction overrides and sets `suspicious: true`.
   - Cleans internal AI phrasing from reasoning and messages.
   - Handles missing API keys and OpenAI service errors gracefully.
3. **`refundOrchestrator.test.ts`**:
   - Short-circuits hard denials without calling the AI service.
   - Short-circuits high-value escalations without calling the AI service.
   - Approves eligible non-suspicious orders.
   - Escalates suspicious requests and prompt injection attempts.
   - Fails safe to `ESCALATED` if AI throws an error.
4. **`refundPersistence.test.ts`**:
   - Persists refund requests with nested audit logs.
   - Resolves customer IDs automatically from orders.
   - Integrates with orchestrator output.
5. **`index.test.ts`**:
   - Validates HTTP endpoints, input payloads, status codes, and JSON response shapes.

---

## Assumptions

- **Refund Window**: Exactly 30 days (`purchaseDate` must be within 30 days of the evaluation date).
- **Refund Amount**: Full order total (partial item-level refund amounts are not evaluated).
- **Authentication**: No user authentication or authorization is implemented, as specified by the assessment scope.
- **Synthetic Data**: Customer and order records are synthetic fixtures designed to cover all edge cases.
- **Authority**: The deterministic policy engine has final, binding authority over hard constraints (final sale, return window, amount threshold).
- **LLM Role**: The LLM provides semantic interpretation and discrepancy analysis rather than policy authority; it cannot approve orders that violate hard rules.

---

## Tradeoffs

- **Pre-Invocation Short-Circuiting**: Skipping the LLM for final-sale and expired orders saves API token costs and latency, but skips conversational AI explanations for why an order was denied.
- **Strict Structured Outputs**: Using OpenAI JSON Schema mode guarantees type safety and parsing reliability, but restricts model selection to providers supporting structured JSON outputs.
- **Fail-Safe to Human Review**: When AI requests fail, the system escalates rather than denying. This protects customer trust at the cost of increasing manual support ticket volume.
- **Monolithic Containerization**: Serving the frontend build via Vite preview in Node rather than a standalone Nginx container keeps the Docker environment lightweight, unified, and free of multi-architecture binary issues.

---

## Future Improvements

- **Partial Item Refunds**: Allow customers to select specific items from multi-item orders rather than evaluating the entire order total.
- **Authentication & RBAC**: Implement session or JWT authentication and role-based access control separating customer accounts from support admin roles.
- **Real-Time Webhooks**: Integrate payment gateway webhooks (e.g. Stripe, Shopify) to trigger automatic payment disbursement upon approval.
- **Admin Review Actions**: Enable support agents to approve or reject escalated requests directly inside the Admin Dashboard.
- **Observability & Tracing**: Add OpenTelemetry spans and structured logging across policy evaluation and LLM API calls for real-time latency and token tracking.
