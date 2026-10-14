# Brief for content writers (read fully before starting)

Project root: `/Users/vaibhav.jain/tajawal/study/masterclass`. You are one of several writers working IN PARALLEL on
different files of the same single-file learning app. Only create/edit the files assigned to you.

## Read first (in this order)
1. `docs/AUTHORING.md` — the contract: schema, 10-step teaching sequence, accuracy rules, maths format, animation schema, lesson registry.
2. The exemplar: `src/content/v1p5-kv-cache.js` and `src/anims/v1p5-kv.js` — match this depth, tone and structure (it is the MINIMUM quality bar; most lessons should be at least as long).
3. Research fact sheets (verified 2026-10-14) in `/private/tmp/claude-503/-Users-vaibhav-jain-tajawal-study/fbad074a-3ce5-469e-918b-1ca517c1f57b/scratchpad/research/`:
   `mcp_a2a.md`, `inference_engines.md` (may still be growing), `k8s_hardware.md` (may still be growing), `sec_ops_agents.md`,
   `part3_mlops.md`, `part5_6_memory_rag.md`. Grep them for your topics. Prefer these over memory for any version/flag/metric/price.
4. The ORIGINAL source books you are improving (audit them for your topics: keep what is right, fix what is wrong, add what is missing):
   - `/Users/vaibhav.jain/tajawal/study/AI_Systems_Engineering_40_Hour_Complete_Package/AI_Systems_Engineering_40_Hour_Book.md` (old Vol 1)
   - `/Users/vaibhav.jain/tajawal/study/AI_Systems_Phase2/AI_Systems_Engineering_Phase_2_30_Hour_Book.md` (old Vol 2)
   - `/Users/vaibhav.jain/tajawal/study/AI_Systems_Interview_Volume_3_Complete_Package/AI_Systems_Interview_Volume_3.md` and `questions.json` (old Vol 3, 120 Qs)

## Rules
- Do not write placeholder or thin content. Each Vol 1/2 lesson: full 10-step sequence, ≥1 static diagram, an animation
  where a mechanism moves (most lessons), worked numbers, a troubleshooting table/decision tree, 4–6 quiz items,
  4–8 flashcards, glossary entries for new terms, cross-links with `L(id,label)` to lessons in the registry.
- Use `@@include(...)@@` ONLY for files that already exist under `labs/` (check with `ls`). Otherwise give short
  inline `code()` snippets (no backslashes inside; escape backticks as \` and `${` as \${ in the template literal)
  and reference the lab path in prose (`labs/README.md` lists planned labs).
- Maths: Unicode, `formula()` blocks, no LaTeX. Recompute every number.
- Never invent versions, flags, metric names, benchmarks or prices; use the research files or phrase version-independently
  or use `callout('unverified', ...)`. Label illustrative numbers as illustrative.
- Keep JS valid: the `html` field is a template literal. Do not use a raw backtick or `${` inside it except for helper calls.
- Scene ids and glossary terms are global: prefix scene ids with your lesson area; before registering a glossary term,
  grep `src/` to avoid duplicates (duplicates are tolerated but wasteful).

## Verify before you finish (mandatory)
1. `node --check <each of your files>`
2. `node build.mjs --check 2>&1 | grep -E "ERROR" | grep -E "<your lesson ids or file names>"` → must print nothing.
   (Errors about OTHER writers' lessons, or "broken link"/"link to missing lesson" pointing to registry ids that other
   writers have not finished yet, are expected — ignore those. Anything else that mentions your ids must be fixed.)
3. Render test: `node build.mjs --force --out=/tmp/<yourname>.html && node test/smoke.mjs --page=/tmp/<yourname>.html --only=<lesson-id>`
   for EACH of your lessons → must end with "ALL CHECKS PASSED" (it steps every animation and fails on console errors).
4. Visual spot check of at least one animation: `PAGE=file:///tmp/<yourname>.html node test/shot.mjs '#/lesson/<id>' /tmp/<you>.png '.anim'` then view the PNG
   (Read tool) — fix overlapping text, labels outside boxes, or elements outside the viewBox.
5. In your final message report: files written, lesson ids, word counts (approx), animations added, anything you
   could not verify, and any audit findings about the old books for your topics (wrong claims you corrected).
