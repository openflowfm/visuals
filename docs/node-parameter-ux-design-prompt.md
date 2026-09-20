# Node parameter UX design exploration

Redesign the UX of the nodes in **visual[flow]**, a node graph editor for creating
procedural visuals. This is a substantial interaction design problem. Explore
several meaningfully different approaches before recommending a direction.

The goal is to **preserve the system’s expressive power while making graphs easier
to understand, edit, and navigate as nodes gain more parameters.**

This brief focuses on node density and parameter editing. The existing
[node graph design prompt](node-graph-design-prompt.md) provides broader product
and first-use context. Verify current behavior against the implementation rather
than assuming every historical description remains current.

Start by inspecting the existing node examples in
[Storybook](http://localhost:5973/?path=/story/nodes-fractal--basic). That URL is the
local preview used during this discussion; if unavailable, consult
[the Storybook documentation](storybook.md) and use the project's unified preview
launcher under the applicable workspace instructions.

Pay particular attention to:

- **Fractal → Basic:** a dense node with numeric parameters and several color controls.
- **Lens → Basic:** image processing, multiple output types, mode selection, and several parameters.
- **Lens → Modulated Ripple:** a source feeds a lens while an LFO drives its depth.
- **Colorway → Basic:** multiple named outputs alongside input controls.
- **Source and LFO:** representative image generators and numeric modulation sources.

Study the rendered examples and interact with them. Use the actual parameter
names, connections, previews, and behaviors in your proposals.

## The problem

Each node currently combines several jobs:

- Identifying its operation and mode.
- Showing a preview or numeric scope.
- Exposing input and output ports.
- Editing parameter values.
- Showing externally driven values.
- Selecting which output to preview.
- Providing node actions such as enable/disable and delete.

These functions share a narrow card with limited hierarchy. As capabilities grow,
nodes become dense forms embedded in a graph.

Observed problems include:

- Fractal exposes roughly ten parameter rows beneath its preview, with little visual grouping.
- Labels such as “secondary” truncate at the current node width.
- Numeric controls, color controls, ports, and mode selection compete for attention.
- A connected image input still displays a disabled color control and the word “wired.”
- An externally driven numeric parameter looks very similar to an ordinary editable slider.
- Colorway places output ports on rows containing unrelated input controls, which can suggest relationships that do not exist.
- Short port labels such as `c`, `p`, and `n` save space but require users to understand the underlying types.
- Preview images are useful, but their size and placement contribute to the space every node consumes.

Do not assume the answer is simply smaller controls, fewer labels, more
whitespace, or hiding everything behind an “Advanced” section. We need a coherent
model for how people understand and manipulate the graph.

## What the design should support

Consider these distinct activities:

1. **Reading a graph:** understanding what produces the image and how signals travel.
2. **Building a graph:** finding a compatible input and making a connection.
3. **Exploring an effect:** trying modes and adjusting several related parameters.
4. **Fine tuning:** entering precise values and understanding their units.
5. **Understanding modulation:** identifying what drives a parameter and observing its current value.
6. **Returning to a graph:** recognizing important customizations and resuming work.
7. **Working at scale:** navigating a graph whose nodes cannot all remain fully expanded.

A successful design should let people move between these activities without
losing their place.

Preserve access to every supported parameter and connection. Treat previews and
visible signal flow as valuable parts of the product. Any proposal that reduces
their prominence should explain how users recover the same understanding.

Distinguish existing behavior from proposed new capabilities. For example, do not
imply that modulation has an editable base value, depth, or offset unless the
current system supports those semantics.

## Directions to explore explicitly

Develop these approaches far enough to reveal their strengths and weaknesses:

### 1. Compact nodes with a dedicated inspector

The graph emphasizes identity, preview, wiring, and a few primary controls.
Selecting a node opens its complete editor in a stable panel.

Explore how users associate the inspector with the selected node, adjust several
nodes in succession, and inspect a parameter’s upstream source without losing
context. Consider the cost of repeatedly shifting attention between canvas and
panel.

### 2. Progressive disclosure inside the node

Nodes expose controls in meaningful groups, with richer editing available locally.

Explore how expansion affects neighboring nodes, wire routing, zoom, and spatial
memory. Decide whether expansion changes layout, overlays nearby space, or uses
another mechanism. Do not leave this behavior unspecified.

### 3. User-curated controls on the canvas

Each node has sensible defaults, and users can expose the controls they frequently
adjust.

Explore pinning, discoverability, restoring defaults, and how a graph communicates
that additional controls exist. Consider how two instances of the same node
remain recognizable when they expose different controls.

For each direction, define what stays visible by default, what appears during
editing, and how users reach everything else.

## Push beyond the obvious approaches

Propose at least **three additional directions that use substantially different
interaction models**. Aim for six total concepts with meaningful differences,
rather than several visual treatments of the same layout.

Use these as creative provocations, not a checklist:

- What if the node were primarily a preview, with direct manipulation of the effect?
- What if wiring and parameter editing had distinct, carefully designed contexts?
- What if selecting a connection revealed the relevant parameter editor?
- What if users could temporarily pull a few controls from several nodes into one tuning surface?
- What if a node exposed a small, expressive instrument-like interface specific to its operation?
- What if detail changed with zoom, selection, or intent?
- What if nodes could unfold into a temporary local workspace while their connection anchors stayed fixed?
- What if the most useful summary were “what differs from the default” or “what is being driven”?
- What if the graph’s overview and its editing surface were complementary representations of the same system?

You may reject these ideas and invent better ones. Explain the interaction insight
behind each concept.

Include at least one ambitious proposal that challenges the current node-card
structure, and one pragmatic proposal that could be introduced incrementally.

Creativity should produce a clearer experience. Avoid novelty that requires people
to memorize invisible gestures or repeatedly switch modes without clear feedback.

## Questions every serious proposal must answer

### Information hierarchy

- What can someone understand at a glance?
- Which controls deserve permanent visibility, and why?
- How do mode-specific parameters appear?
- How are identity, operation, state, and actions differentiated?

### Connections and modulation

- Where are ports, and how are their names and types communicated?
- How can users connect a parameter that is currently hidden?
- What happens to an existing connection when its controls collapse?
- How do manual values and externally driven values look different?
- How can users identify and inspect the source of a driven parameter?
- What happens when a mode change affects available parameters?

### Previews

- When is a preview visible, enlarged, reduced, or absent?
- How do image previews, numeric scopes, and multiple outputs fit the model?
- How is preview selection distinguished from wiring and enable/disable state?

### Interaction and layout

- What changes when a node is selected?
- How do users edit precisely without accidentally dragging the node or canvas?
- Does revealing detail move nodes or connection anchors?
- What happens when several nodes need attention at once?
- How does the design work with keyboard navigation and without relying solely on color or hover?

### Predictability

- Which presentation choices persist?
- What is automatic, and what is under user control?
- Can users always explain why a control is visible or hidden?
- How does the interface avoid jumping or changing beneath them?

## Show concepts in realistic context

Do not present only an attractive isolated node.

Use the same examples across concepts so we can compare them:

- A dense **Fractal** node.
- The **Source → Lens → Output** graph, with **LFO → Lens depth** modulation.
- A **Colorway** node with multiple outputs.
- A larger graph containing several node types, including repeated instances.

For the strongest concepts, show:

- Default graph view.
- Selected node.
- Detailed parameter editing.
- A connected or modulated parameter.
- Discovering and connecting a currently hidden input.
- A zoomed-out graph overview.

Use realistic labels and values. Demonstrate difficult states instead of replacing
them with simplified placeholder content.

Annotated sketches are sufficient during exploration. Refine the interaction
model before investing in polished styling.

## Evaluate the alternatives

Compare the concepts against:

- Graph readability.
- Speed of common adjustments.
- Discoverability of less-used parameters.
- Clarity of connections and modulation.
- Spatial stability.
- Scalability to larger graphs.
- Precision and accessibility.
- Learning burden.
- Implementation complexity.

Explain what each concept improves and what it makes harder. Identify failure
modes and uncertainty rather than declaring every idea successful.

Choose two finalists and walk through the same tasks:

1. Find and adjust Fractal’s interior brightness.
2. Connect an LFO to Lens depth.
3. Understand why depth is changing.
4. Adjust several parameters across Source and Lens.
5. Return to the graph later and recognize its important settings.

Recommend a direction based on those walkthroughs. If a hybrid is strongest,
explain the single coherent rule that governs when each editing surface is used.
Avoid combining every idea into a larger, more complicated system.

## Deliverables

Provide:

1. A concise diagnosis grounded in the existing examples.
2. Six distinct concepts, including the three requested directions.
3. Annotated visual studies showing their interaction models.
4. A comparison of their benefits, costs, and likely failure modes.
5. Two finalists demonstrated through the same realistic tasks.
6. A recommended direction and the assumptions it depends on.
7. A small prototype plan identifying the interactions we should test first.

Keep this phase focused on exploration and prototypes. The outcome should give us
a strong basis for choosing a UX direction before changing production behavior.

**The central challenge: make the graph feel approachable and legible while
keeping its full power close at hand.**
