# Flow editor design intent

Recorded September 20, 2026, following Ryan's design discussion.

**Status: product intent agreed. Visual design unresolved.** The generated studies
in this folder are explorations, not approved designs or implementation specifications.
Pause further visual exploration here. This record is the reference for the next pass.

## The outcome

Someone can arrive with a specific idea or discover something they like, quickly
reach a meaningful taste decision, and obtain a usable result from that choice.
The interface does not ask them to select an exploration mode or a goal-driven
mode first.

The unit of progress is **one taste decision that leaves usable work behind**.
Each choice can be a stopping point. Continuing is optional, and previously
captured work survives later choices and corrections.

For visual[flow], the intended journey is a blank canvas, a picture worth choosing,
useful transformations or movement, and a saved visual someone would actually use.
Port types, modulation terminology, and parameter setup should not be prerequisites.

## Choices present results

- Clicking the blank canvas should quickly reveal visual possibilities that are
  already meaningful to judge.
- Previews are central. Where applicable, transformation choices show their effect
  on the user's current picture.
- A choice supplies suitable configuration and connections together, rather than
  leaving the user with a new setup task.
- Someone with an idea must be able to steer toward it without browsing a vast
  catalog. Someone exploring must be able to respond directly to what they see.
- Ask only questions that help the next meaningful decision. Do not turn this
  into a mandatory wizard or a sequence of technical questions.

## Flow outlet

The working name is **flow outlet**, replacing the earlier “magic outlet.”

A flow outlet represents what a node can offer as a whole. Connecting it to
another node can create several complementary connections when the source and
target support them, such as picture, position, and numeric modulation.

The intended result is a useful arrangement. Maximizing the number of compatible
wires is not itself a success criterion. Appropriate settings and modulation
amounts are part of the arrangement.

An obvious useful match should require little effort. When there are several
meaningful arrangements, a small set of previewed outcomes can let the user apply
taste. The exact matching and choice mechanics remain open.

Replacement is a first-class interaction. The interface must make the proposed
replacement understandable without requiring the user to dismantle and rebuild
the surrounding work.

Precise individual connections remain available. Approaching a target with an
individual cable can reveal compatible inputs without permanently exposing every
input on every node.

## Detailed editing serves a specific intention

Detailed control remains capable and accessible. It should not become a required
refinement phase after every useful choice, or the primary invitation to explore
the product.

The motivating correction is: “This moves too far; tighten the range.” The user
can fix that one thing directly and preserve everything else. Retrying should
not require reconstructing settings or connections.

Complexity appears when it serves expressed intent. It does not need to unfold
automatically merely because a connection succeeded.

## Interaction direction worth retaining

Ryan liked the interaction pattern of adjustments on small breakouts attached to
the node. The breakout and node should read as one coherent interface element.

At rest, the graph remains quiet. Hover can reveal the relevant inline adjustment
without opening an entire parameter panel. Focus and touch equivalents, stable
connection targets, and keeping a control open during adjustment are design
requirements to resolve in a prototype, not reasons to expose everything by default.

Showing changed or connected parameters while hiding untouched defaults is a
promising disclosure rule, not a requirement to display all their controls continuously.

## Visual intent, without prescribing a style

- Keep people in a world of pictures. Explore an overview with previews and light
  iconography rather than persistent words on every node.
- Use visual cues for signal meaning, such as picture, motion, or position. Exact
  iconography and how people recognize operations remain unresolved.
- The idea of containers holding energy is useful as a metaphor. Energy can move
  through connections and visibly influence a receiving node.
- Gentle motion should communicate actual signal activity. A numeric oscillator
  can appear as a light pulsing with its value rather than always showing a waveform.
  Range, frequency, and precise details become available on demand.
- The pulse direction resonated strongly. This does not select one exact light
  shape, gradient, or brightness mapping.
- Some gloss is welcome. Literal glass vessels, chrome fittings, thick physical
  housings, and product-render styling went too far. This is an application.
- The later restrained studies also did not settle the design. None is a chosen
  visual system, and the task is not to combine approved fragments from every board.

## Success criteria for a future proposal

These are evaluation questions, not validated metrics or numerical targets:

- How quickly does someone reach the first meaningful taste decision?
- Does accepting a choice produce a perceptible, usable result without more setup?
- Can they accept the result and move forward without an obligatory refinement phase?
- Can someone pursuing a specific idea steer toward it without unrelated browsing?
- Can they correct one mismatch without losing the surrounding work?
- Is the graph understandable when returning to it, despite reduced labels and controls?
- Does signal motion help understanding while the graph stays calm?

A surprising or rough result can still be creatively useful. Technical validity
alone is insufficient, and unexplained inactivity should not be the normal reward
for experimenting.

## Broader principle

This intent applies beyond visual[flow] to music and the work[flow] idea: preserve
what the person came to express, delay unrelated decisions, and carry each choice
through to something usable. For example, someone who arrives with a drum pattern
should be able to capture it with a usable sound before choosing a drum library.

## What remains open

The exact appearance, node geometry, icon system, disclosure mechanics, arrangement
selection, signal animation, and saved presentation state remain design work.
The discussion does not authorize a renderer rewrite or establish that these
features already exist. The next proposal should demonstrate the outcome above
and remain accountable to it.
