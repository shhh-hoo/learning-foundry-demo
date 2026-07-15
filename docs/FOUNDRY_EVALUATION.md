# Foundry evaluation

Foundry evaluation asks whether a component can safely enter Standard Trainer. It does not judge learner work.

The pipeline reports `PASS`, `FAIL`, or `WARNING`, evidence, and an optional recommendation for:

- schema validity;
- curriculum alignment;
- required information;
- reasoning graph and dependency integrity;
- accepted strategy completeness;
- formula reference integrity;
- deterministic recomputation;
- target answer consistency;
- unit and significant-figure consistency;
- mark scheme alignment;
- hint policy integrity;
- runtime capability compatibility;
- duplicate similarity risk.

A deliberately invalid generated mass component changes the MgO coefficient from 2 to 1. The schema remains valid, but deterministic recomputation produces `4.00 g` while the authored target remains `8.00 g`; publication is therefore blocked.

Duplicate similarity is a warning in this demo because only two registry entries exist. A production workflow would compare against the complete governed registry.

