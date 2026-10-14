# AI Systems Engineering Masterclass

**From DevOps to AI Platform Engineering, MLOps, LLMOps, AIOps, GPU Infrastructure and Hyperscale AI Architecture**

Open `index.html` (or `dist/index.html`) in any modern browser. It is one self-contained file: no server,
no CDN, no account, works offline. Progress, notes, bookmarks, quiz and flashcard history are stored in
the browser (export/import them from the Progress dashboard).

## What is inside
| | |
|---|---|
| Volume 1 — Build and Understand AI | 25 lessons: ML foundations → LLM internals → training/fine-tuning → GPU/CUDA → inference engines → Kubernetes |
| Volume 2 — Architect, Scale and Operate AI | 38 lessons: platform architecture, caching masterclass, distributed systems, MLOps, RAG, a 13-lesson MCP & agents track, hyperscale, AIOps, FinOps, security, capstone |
| Volume 3 — Master AI Engineering Interviews | 25 lessons: 179 questions with ten-part answers (incl. 25 MCP questions), whiteboard maths, debugging drills, system design, 10 scored mock rounds, and the five "Prove it" checkpoints |
| Reference | glossary (600+ terms), 35 formulas, 14 tool comparisons, 17 runbooks, career roadmap and skills matrix, technical audit with sources |
| Visuals | 126 step-through animations with playback controls, narration scripts and reduced-motion support; diagram and animation libraries |
| Labs | 12 runnable labs in `labs/` (results in `labs/TEST_RESULTS.md`), including tested MCP servers in Python and TypeScript and the infrastructure-optimisation capstone |

Facts that change quickly (versions, flags, prices, regional availability) were checked against official
sources on 2026-10-14 and are dated in the text; see the "Technical audit & sources" page.

## Rebuild and test (for maintainers)
```bash
node build.mjs --check          # validates every lesson, link, quiz, animation and include
node build.mjs                  # writes dist/index.html (single file)
node test/smoke.mjs             # headless Chrome: every lesson, every animation step, every route, features
labs/run_tests.sh               # runs the lab tests (see labs/README.md for the Python environment)
```
Sources live in `src/` (content, animations, questions, reference); authoring rules are in `docs/AUTHORING.md`.
# jain-tt.github.io
