# Demo

The canonical demo is `http://127.0.0.1:4173/?view=demo`. It is a live Demo Shell around real product routes, not a video or a set of presentation overlays inside the products.

Guided Story has six scenes:

1. Student clicks **Check my working**; `LEARNER_DIAGNOSIS_COMPLETED` explains the bounded diagnosis outside the frame.
2. Library and Schedule prove that evidence, correction and delayed transfer were preserved.
3. Foundry Studio shows `2 historical + 1 current = 3` after `PATTERN_THRESHOLD_REACHED`.
4. Teacher creates the candidate; Foundry evaluation and expert approval remain separate gates.
5. Publishing emits `COMPONENT_PUBLISHED`; the local bridge must emit `REGISTRY_COMPONENT_ACCEPTED` before the scene completes.
6. Standard Trainer loads v1.1.0, diagnoses the same ratio error and renders the governed strengthened hint.

Free Explore opens Learner Workspace, Foundry Studio, Engineering Inspector or Standard Trainer without step gates. Run `npm run storyboard` to reproduce the canonical seven-frame image story. `demo-recording/learning-foundry-product-demo-zh.mp4` is a previous walkthrough, not the authoritative demo.
