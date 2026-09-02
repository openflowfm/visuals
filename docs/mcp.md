# Agent authoring

`mcp/index.ts`, `mcp/server.ts`, `mcp/authoring.ts`.
The MCP boundary through which an agent reads the real node vocabulary, proves a graph, and
writes one flow without guessing at the file format.

## The boundary

The server is a local **stdio** MCP server. It does not bind a port, join Ableton Link or
connect to the bridge. Its one external effect is `save_flow`, which writes the open scheme in the library —
`~/.openflow/visuals/schemes/<id>.json` — the same file the app watches. A running visuals
server sees that file change and publishes the result to its browsers in the ordinary way,
unless the screen holds unsaved edits: then the server keeps them, says the file moved, and
leaves the choice — save overwrites, load takes it — to a person.

Run it from the repository root:

```sh
npm --prefix visuals run mcp
```

An MCP host can configure it with an absolute repository path:

```json
{
  "mcpServers": {
    "visual-flow": {
      "command": "npm",
      "args": ["--prefix", "/absolute/path/to/better-session-view/visuals", "run", "mcp"]
    }
  }
}
```

Set `OPENFLOW_VISUALS_SCHEME` in that process to pin one exact file instead of the
library's open scheme. Nothing except JSON-RPC is written to stdout; diagnostics go to stderr,
because one ordinary log line on stdout corrupts a stdio MCP session.

The system **Examples** scheme has no writable file. If it is open, authoring refuses to
start with a read-only message; use the console's **save as** field to make a user scheme,
then start the MCP server against that scheme.

## What an agent gets

Two resources carry context rather than pretending a read is an action:

| resource | contains |
|---|---|
| `visual-flow://nodes` | every node, mode, mode-dependent inlet, outlet, signal, description, media target, bypass availability and iterative work ceiling |
| `visual-flow://scheme` | the resolved scheme and the exact revision of the file it came from |

Two prompts give a host model the order of work: `build-flow` and `design-node`.

Six tools do the bounded operations:

| tool | effect |
|---|---|
| `list_nodes` | read the whole documented vocabulary, or one kind |
| `list_flows` | read flow ids, names, graph sizes and the current revision |
| `get_flow` | read one complete graph and validate it against the current library |
| `validate_flow` | prove a draft without writing anything |
| `save_flow` | create or explicitly replace one validated flow |
| `review_node_design` | review a proposed node boundary and return its code/doc/test plan |

The tool annotations say which are read-only, which write, that nothing reaches an open-world
service, and that `save_flow` can replace an existing flow only when its caller says so.

## Building a flow

The reliable sequence is:

1. Read `list_nodes`; never invent a port or infer one from a shader name.
2. Read `list_flows` to learn nested-flow ids and hold its `revision`.
3. Write a complete `FlowDef`: a name, nodes with canvas positions, cords addressed as
   `nodeId/portName`, and exactly one `out` node.
4. Call `validate_flow` until it has no errors.
5. Call `save_flow` with the revision from step 2. If the app or another agent changed the
   file meanwhile, read again and deliberately reconcile the new graph.

Validation is stricter than `server/scheme.ts`. The scheme loader carries old files forward
and repairs shapes previous versions wrote; silently repairing a graph an agent just proposed
would hide the most useful feedback from the author. The MCP door therefore reports:

- duplicate or malformed node ids;
- unknown kinds, modes, inlets, outlets, held values and previews;
- a disabled node with no real dry input to pass through;
- values outside 0–1 and depths outside -1–1;
- missing nodes, wrong port direction, incompatible signals and two cords into one inlet;
- node-level cycles and recursive nested flows;
- a missing or repeated `out`, plus a visible warning when nothing reaches it;
- the compiler's uniform, track-bank and multi-tap size limits.

Media nodes report typed targets (`media:image` or `media:video`) rather than one ambiguous
media flag, and validation reports reachable image and video counts separately.

Only a graph that passes that list is written. The write is an atomic rename, so the file
watcher sees either the previous complete scheme or the next complete scheme, never half JSON.
The expected revision hashes the exact file, including an explanatory `_` block the app
preserves, so a write cannot erase a concurrent hand edit merely because the resolved schemes
happen to look the same.

## Designing a node

A new flow is data. A new node is code, and the MCP server must not blur that distinction.
Adding a node kind can change the saved protocol, compiler, shader cost, server-fed uniforms,
browser, tests and user manual. `review_node_design` therefore does not write a plausible stub
that compiles but draws nothing. It makes the agent state the boundary first:

- one kind and a plain-language general description;
- the headless behavior rather than a control mockup;
- why this is a kind rather than a mode of an existing kind;
- every inlet and outlet with `p`, `n` or `c` and a description;
- every fixed mode with a description and, where it differs, its complete inlet list;
- whether each number inlet holds a 0–1 default or follows live beat/energy;
- the honest runtime class: expression, multi-tap, render pass, CPU state or set data.

The review rejects missing documentation, duplicate ports and modes, invalid defaults, names
that already mean something in a DAW, and an existing node kind. It also returns every existing
mode with the same signal signature: the concrete evidence for asking whether this is really
one more mode whose wiring should stay put.

A ready review returns the implementation route through a discovered `client/nodes/<kind>/`
folder, its documented `NodeSpec`, renderer/server work appropriate to its runtime class, derived browser,
compiler tests, `docs/flows.md`, and the Visuals wiki. The agent still makes and verifies those
changes in the repository; MCP supplies the contract and the current facts rather than a
second extension system beside the real one.

## Why the generated manifest and documentation contract are the source

`nodeCatalog()` walks the generated folder manifest and serializes each `NodeSpec` directly.
It does not have a hand-maintained MCP copy or a second list of kinds.
The contract added in `client/render/circuit.ts` already makes every node, fixed mode and port carry
documentation; the MCP catalog is another consumer beside browser search and faceplate help.
Adding a protocol mode without its description remains a TypeScript error, and adding a dynamic
inlet without its description remains one too.

That is the important property for agents: the context they read is executable truth. If a
node's real inlet changes, its MCP schema changes in the same edit or the project does not
typecheck.
