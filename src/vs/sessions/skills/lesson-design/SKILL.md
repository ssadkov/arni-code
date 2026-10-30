---
name: lesson-design
description: "Turn supplied teaching material into a source-grounded lesson and a self-contained interactive HTML quiz with explanations."
metadata:
  version: 1.0.0
---

# A small teachable unit

For a capabilities question, describe the workflow without creating files. For a lesson, establish learner level, objective, duration and source coverage. Separate author material from added examples. If reading a book/PDF, establish extraction coverage and use source-research conventions; do not pretend to have read inaccessible pages. Do not invent facts or attribute your examples to the author.

Prepare an explanation, short practice and feedback tied to the source. For the first interactive lesson use `scripts/lesson.py` (Python 3 standard library):

```text
<python> lesson.py --plan lesson.json --output lesson.html
```

Plan format: `{"title":"...","passage":"source text","source":"file/chapter","questions":[{"question":"...","choices":["...","..."],"answer":0,"explanation":"...","evidence":"exact substring of passage"}]}`. The helper checks choice indices and evidence presence and escapes material into a single offline HTML file. This checks provenance anchors, not semantic truth or educational effectiveness. The answer key is embedded for self-study, not a secure graded exam.

Open the HTML in the available browser. Test a correct answer, an incorrect answer, score, keyboard access and a narrow viewport. Inspect a screenshot; if browser tools are missing, state that interactivity/appearance were not verified. Finish with lesson/plan paths, source coverage and what was checked. Original documents remain unchanged; do not publish or upload student information.

First tests: a 10-minute beginner lesson from a supplied paragraph, then adapt it to a younger audience without changing the source facts. Use an explicit assessment rubric before offering feedback on real student work.
