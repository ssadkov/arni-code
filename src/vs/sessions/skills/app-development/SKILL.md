---
name: app-development
description: "Build or fix a local website or small application, run it and verify the requested behavior. Use for landing pages, simple apps and reproducible bugs."
metadata:
  version: 1.0.0
---

# Build and verify

For a capabilities question, describe supported work without changing files. Otherwise establish the desired result, input assets and acceptance criteria. Ask only about decisions that materially change the task. Inspect an existing project before choosing a stack; for an empty folder a self-contained HTML/CSS/JS app is a useful starting point, not a constraint on every project. Keep the user's selected model and preserve unrelated work.

For creation, implement the smallest complete user flow. For a bug, reproduce it before patching and verify the original trigger afterwards. Use available terminal/browser tools; do not claim runtime success from a successful file write. Do not install a runtime or dependency silently; explain what is missing and the proposed local setup. Work in the user-selected project, not an unrelated folder.

For a landing page, use supplied references/assets, coherent typography and responsive layout. Open the actual page and inspect screenshots at desktop and phone widths. Check navigation, buttons, form validation, horizontal overflow and the console. A screenshot does not establish that a form sends data. Do not invent a backend, real testimonials, business metrics or working contact delivery. If browser/screenshot tools are unavailable, report the unverified checks.

For apps, exercise the main flow and relevant failure cases; use focused automated tests where they add evidence. Avoid repeatedly launching the same check after it passed. Finish with output paths, how to run/open, what was actually checked and remaining limitations. Open the local result in the application's browser when possible. Publishing, payments, credentials and external data changes are separate tasks, not side effects of previewing.

First tests: a coffee-shop landing from local assets; a price calculator with invalid-input handling; a broken filter in an existing catalog. A second request should modify the existing result without recreating the project.
