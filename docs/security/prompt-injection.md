# Prompt injection: what Hearth enforces and what it only asks

Hearth sends household text to language models in three places: document
extraction (local Ollama or your own cloud key), the Assistant chat, and the
MCP server. Any of that text can carry instructions written by someone else:
a PDF from a provider, a photo of a letter, or a note a household member
pasted in. This page says which defences are hard limits and which only ask
the model to behave (#530).

## Enforced

These hold whatever the model does.

| Where | Control | Code | Test |
|---|---|---|---|
| Assistant | A model can only *propose* a create or update. Nothing is written until a member taps Confirm on the card. | `propose_*` tools in `src/lib/chat/tools.ts`, `ProposedActionCard` | `tests/unit/prompt-injection-assistant.test.ts`, `e2e/specs/09-assistant-guarded-writes.spec.ts` |
| Assistant | Only the registered tools run. There is no delete tool and no direct write tool, and READONLY members get no `propose_*` tools at all. | `runTool`, `getAvailableTools` | same |
| Assistant | Confirming re-validates the card's data against the same Zod schemas as the forms. Keys the forms don't have (ids, `createdById`, `deletedAt`) are dropped, and a link to a record in Trash or in a disabled module is refused. | `createContractFromAssistant` and friends in `src/lib/actions/` | same |
| Assistant | Tool results are built with `JSON.stringify`, so record text reaches the model and the chat route only as string values. A note can't forge a proposal card. | `runTool`, `src/app/api/chat/route.ts` | same |
| Extraction | A model's answer only pre-fills a review form a member saves from. It never writes a record by itself. | `src/lib/documents/*Extraction.ts` | `tests/unit/prompt-injection-extraction.test.ts` |
| Extraction | Every answer goes through `whitelistFields`: only the domain's own keys are kept, objects, arrays, booleans and blank strings are dropped, numbers are turned into strings, and any string over 300 characters is dropped. | `src/lib/ai/parseJson.ts` | same |
| MCP | Read tools are read-only. The import scope only adds proposals to a review queue that a member approves. | `src/lib/mcp/server.ts` | `tests/unit/mcp-read-only.test.ts`, `tests/unit/mcp-imports.test.ts` |

## Review aids on the card

The card makes a steered proposal easier to spot. It doesn't block anything.

- An update shows each changing field's current value under the proposed
  one ("Now: …").
- Free-text fields (title, provider, contact details, notes) are shown in
  full and shaded as the Assistant's wording.
- A field is flagged when it has a link or email address that isn't already
  on the record, is over 500 characters, or reads like instructions to an
  AI. A new record's own contact email isn't flagged. The rules live in
  `src/lib/chat/proposalReview.ts` (`tests/unit/proposal-review.test.ts`).

## Advisory

These lower the odds a model follows injected text, but a model can ignore
them. Treat them as a first layer, not a boundary.

- The Assistant's system prompt tells the model that tool results and record
  text are data, not instructions (`src/app/api/chat/route.ts`).
- Every extraction prompt carries an untrusted-content notice. BYOK prompts
  get `UNTRUSTED_DOCUMENT_NOTICE` in `extractWithByok`, and Ollama prompts are
  built with `untrustedTextPrompt` (`src/lib/ai/untrustedContent.ts`). A unit
  test fails if a domain extractor builds its Ollama prompt any other way.
- The MCP server's instructions tell clients that free-text fields are data.
- `AI_EGRESS_PROXY_URL` can route provider calls through an agent firewall
  (see the README). It inspects traffic but depends on the firewall's rules.

## What this means for members

- Read a proposal card before tapping Confirm, especially free-text fields
  such as notes, contact details and URLs.
- Check the review form after a scan. A steered model can still put a wrong
  but short value in a real field.
- If an agent connected over MCP also has write tools from other servers,
  keep its confirmations on.

## Known gaps

- The Ollama text fallback in `src/lib/documents/*Extraction.ts` calls
  `/api/generate` with a plain `fetch`. Every provider in `src/lib/ai/`
  goes through `AI_EGRESS_PROXY_URL` when it is set, and the other two
  Ollama calls also run `assertSafeOutboundUrl`, but this fallback does
  neither.
- There is no eval against a real provider in CI, because it needs a key.

## Adding a new AI feature

- Build Ollama extraction prompts with `untrustedTextPrompt`, and pass every
  answer through `whitelistFields` with the domain's own keys.
- A new Assistant write must be a `propose_*` tool with `isWrite: true`, and
  its confirm action must re-parse with the form's schema.
- Never add a write tool to the MCP server, and never return credentials or
  raw document bytes from it.
