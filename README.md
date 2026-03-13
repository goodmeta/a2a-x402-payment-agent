# A2A x402 Payment Agent

An [A2A](https://a2a-protocol.org/) agent that pays for [x402](https://www.x402.org/)-protected APIs on behalf of other agents — automatically handling payment via ERC-2612 permit signing.

This is the first open-source example bridging the **A2A** (agent-to-agent communication) and **x402** (agent payments) protocols.

## The Agentic Infrastructure Stack

Three protocols form the foundation of autonomous agent infrastructure:

```
┌──────────────────────────────────────────────────────────┐
│                    Agent Orchestrator                     │
├──────────┬──────────────────────┬────────────────────────┤
│   MCP    │         A2A          │         x402           │
│  (tools) │   (collaboration)    │      (payments)        │
├──────────┼──────────────────────┼────────────────────────┤
│ Agent ↔  │ Agent ↔ Agent        │ Agent → Paid API       │
│ Tools &  │ Discovery, delegation│ HTTP 402 → ERC-2612    │
│ Data     │ task lifecycle       │ permit → retry         │
├──────────┼──────────────────────┼────────────────────────┤
│Anthropic │ Google/Linux Found.  │ Coinbase               │
└──────────┴──────────────────────┴────────────────────────┘
```

| Protocol | Direction                             | What it does                                                      |
| -------- | ------------------------------------- | ----------------------------------------------------------------- |
| **MCP**  | Vertical — agent → tools              | Gives an agent access to APIs, databases, files                   |
| **A2A**  | Horizontal — agent ↔ agent           | Agents discover each other, delegate tasks, stream results        |
| **x402** | Transactional — agent → paid resource | Agent pays for API access using USDC (gasless, off-chain signing) |

**They compose.** An orchestrator uses A2A to delegate to specialist agents. Each specialist uses MCP to access its tools. x402 handles payment whenever an API costs money. This example demonstrates the A2A + x402 intersection.

## What This Example Does

```
┌─────────────┐       A2A        ┌───────────────────┐      x402       ┌──────────────┐
│ Client Agent │ ──────────────► │ x402 Payment Agent │ ─────────────► │  Paid API    │
│ (any agent)  │ ◄────────────── │   (this example)   │ ◄───────────── │  (HTTP 402)  │
└─────────────┘   task + result  └───────────────────┘  pay + fetch    └──────────────┘
```

1. **Client agent** discovers the Payment Agent via its [Agent Card](https://a2a-protocol.org/latest/specification/#5-agent-card)
2. Client sends an A2A task: "fetch this URL"
3. Payment Agent hits the URL. If it gets HTTP 402 (Payment Required):
   - Parses payment requirements (amount, token, chain)
   - Signs an ERC-2612 USDC permit (off-chain, gasless)
   - Retries the request with the payment signature header
4. Returns the API response as an A2A artifact, streamed back to the client

## A2A Concepts Demonstrated

### Agent Card (`/.well-known/agent-card.json`)

Every A2A agent publishes a card describing its identity, capabilities, and skills. This is how agents discover each other — like DNS for AI agents.

→ See [`src/server/agent-card.ts`](src/server/agent-card.ts)

### Task Lifecycle

A2A tasks progress through states: `submitted → working → completed/failed`. This agent streams status updates so the client knows what's happening in real-time.

```
SUBMITTED → WORKING → COMPLETED
                    → FAILED
                    → INPUT_REQUIRED (multi-turn)
                    → CANCELED
```

→ See [`src/server/executor.ts`](src/server/executor.ts)

### Messages, Parts, and Artifacts

- **Messages** carry requests (from client) and status updates (from agent)
- **Parts** are content containers: text, structured data, or files
- **Artifacts** are the deliverable outputs — in our case, the API response

### Streaming (SSE)

The agent streams `TaskStatusUpdateEvent` and `TaskArtifactUpdateEvent` events via Server-Sent Events, so the client gets real-time progress.

→ See [`src/client/demo.ts`](src/client/demo.ts) for streaming consumption

## x402 Concepts Demonstrated

### The Payment Flow

x402 extends HTTP with a payment layer. No SDK needed — just standard HTTP + EIP-712 signatures:

1. `GET /api/data` → Server returns **HTTP 402** with payment requirements
2. Agent reads requirements: amount, token (USDC), chain (Base), facilitator URL
3. Agent signs an **ERC-2612 permit** — an off-chain authorization for the facilitator to transfer USDC
4. Agent retries with `PAYMENT-SIGNATURE: base64(payload)` header
5. Server verifies + settles the payment via the facilitator, then returns the data

→ See [`src/server/x402.ts`](src/server/x402.ts) for the full implementation

### Why ERC-2612?

Permits are **gasless** — the agent signs a typed message, not a transaction. The facilitator handles the on-chain settlement. This means agents can pay for APIs without needing ETH for gas.

## Quick Start

### Prerequisites

- Node.js 18+
- A wallet with USDC on Base Sepolia (testnet)
- Get testnet USDC from the [Base Sepolia faucet](https://faucet.circle.com/)

### Setup

```bash
git clone https://github.com/goodmeta/a2a-x402-payment-agent.git
cd a2a-x402-payment-agent
npm install
cp .env.example .env
```

Edit `.env` with your wallet private key:

```env
AGENT_PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE
CHAIN=base-sepolia
FACILITATOR_URL=
```

### Run the Server

```bash
npm run server
```

The agent starts at `http://localhost:3000` with its Agent Card at `/.well-known/agent-card.json`.

### Run the Demo Client

In another terminal:

```bash
# Fetch any URL through the payment agent
npm run client -- https://some-x402-protected-api.com/endpoint

# Or just run with default URL
npm run client
```

The client discovers the agent, sends a task, and streams the result.

## Project Structure

```
src/
├── server/
│   ├── index.ts          # Express server — wires A2A handlers
│   ├── agent-card.ts     # Agent Card definition (identity + skills)
│   ├── executor.ts       # AgentExecutor — task handling logic
│   └── x402.ts           # x402 payment client (HTTP 402 → permit → retry)
└── client/
    └── demo.ts           # A2A client — discovers agent + sends tasks
```

## Further Reading

- [A2A Protocol Specification](https://a2a-protocol.org/latest/specification/)
- [A2A Key Concepts](https://a2a-protocol.org/latest/topics/key-concepts/)
- [A2A + MCP: How They Work Together](https://a2a-protocol.org/latest/topics/a2a-and-mcp/)
- [x402 Protocol](https://www.x402.org/)
- [ERC-2612: Permit Extension for ERC-20](https://eips.ethereum.org/EIPS/eip-2612)

## Built by

[Good Meta](https://goodmeta.co) — x402 integration services for AI-native companies.
