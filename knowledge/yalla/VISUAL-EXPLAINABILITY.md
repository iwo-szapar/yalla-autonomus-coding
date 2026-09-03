# Visual explainability

Use a visual when it makes an active Yalla decision, system boundary, or proof
gap materially easier to understand than a short paragraph. The goal is not to
make every run visual; it is to give the operator the smallest accurate shape of
what matters.

## Select the smallest truthful view

| Question | Shape | Include |
| --- | --- | --- |
| What branches or state changes? | Pseudocode | Conditions, transitions, terminal states |
| What calls what? | Indented call tree | Entry point, meaningful calls, system boundary |
| Who owns which code? | Component or file tree | Paths, ownership, relevant shared modules |
| What changed? | `diff` sketch | Existing context plus the added/removed behavior |
| How do actors or services interact? | Mermaid flow or sequence | Actor, message, failure/recovery handoff |
| Which option should we choose? | Focused HTML decision aid | Options, tradeoffs, risk, recommendation |

The visual must use real code, artifact, and interface names. It should show
only the boundaries necessary for the current question. Omitted detail is a
feature when it does not change the decision.

## Placement and proof

Place the visual directly beside the brief text it supports. Follow it with a
plain-language conclusion and the actual proof status:

```text
Proof status: not proven yet — checkout rejection still needs the API integration test.
```

A diagram is explanatory, not evidentiary. Only a captured test result, browser
run, static artifact, benchmark, trace, screenshot, or equivalent verifier
output may support a Proof Contract criterion. Label assumptions and inferences
explicitly.

## HTML decision aids

Create an HTML artifact only when an option comparison, visual UI state, or dense
system boundary cannot be communicated faithfully with a code block or Mermaid.
Use real labels and data, show the recommendation and its tradeoff, support
desktop and 375px mobile layouts, and avoid generic dashboard chrome. A planning
artifact belongs in `plans/active/issue-###-visual.html`; do not create one for
routine implementation updates.

## Quality check

Before sharing, verify that:

- the reader can answer the intended question without reading code;
- every label maps to a real source or is explicitly marked inference;
- the visual does not hide error, recovery, or ownership boundaries that change
  the decision; and
- the stated proof status agrees with `.pipeline/acceptance-trace.json` and
  `.pipeline/outcome-evaluation.json`, when those artifacts exist.
