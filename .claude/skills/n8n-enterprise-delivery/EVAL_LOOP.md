# The eval loop: dataset, nodes, metrics, gate

Reference depth for the eval loop section of `SKILL.md`.

## Dataset shape

The dataset lives in an n8n **data table** or a **Google Sheet**, one row per case,
with three kinds of column:

- **inputs**, what the workflow receives
- **expected output**, the reference answer (optional, but required by most metrics)
- **actual output**, left blank and written back by the run

Remember from the source control section: **data table schemas sync, rows do not.**
An eval dataset is environment-local. Either keep the dataset in one place and point
each environment at it, or accept that it is seeded per instance.

## The two nodes

- **Evaluation Trigger** emits one item per dataset row. "Evaluate all" runs the
  workflow once per row, sequentially. "Max rows to process" caps it, which is how
  you smoke-test the wiring on one row before spending a full run.
- **Evaluation node** with three uses: **Set Outputs** writes the result back to the
  dataset, **Set Metrics** scores it, and a **check-if-evaluating** branch keeps both
  off the production path. Put metric and write-back logic behind that branch or
  every production execution pays for the judging.

## Built-in metrics

| Metric | Range | Measures |
|---|---|---|
| Correctness (AI judge) | 1 to 5 | Meaning is consistent with a reference answer |
| Helpfulness (AI judge) | 1 to 5 | Response actually answers the query |
| String Similarity | 0 to 1 | Edit distance against a reference |
| Categorization | 0 or 1 | Exact match against a reference |
| Tools Used | 0 to 1 | Whether the execution used tools |

Custom metrics: compute the value in the workflow, map name and value into the
Evaluation node. Use these for anything domain-specific, which is most of what a
customer actually cares about.

## There is no built-in gate

n8n reports summary scores per metric per run and lets you compare runs. It does not
pass or fail anything. **The gate is yours to define**: pick the metric, agree a
threshold with the customer in writing, and put it in the handoff. Without an agreed
threshold an eval suite is a dashboard, and a dashboard does not block a promotion.

Budget the wall clock: `N8N_CONCURRENCY_EVALUATION_LIMIT` defaults to 1 on
Community and Pro, 3 on Business, 5 on Enterprise. A 200-row dataset against an LLM
on a Pro instance runs serially and takes as long as it takes.

**Worked shape** (build one of these first, it is the cheapest useful eval):
classification. Input is the raw text, reference is the correct category, metric is
Categorization, threshold is whatever the customer's current manual accuracy is. It
is unambiguous, needs no AI judge, and it produces a number the customer already has
an opinion about.

`[FIELD]` a real worked example: dataset size, the metrics chosen, the threshold
agreed, and what the first run scored versus the third. The before-and-after is what
makes the eval loop sellable to the next customer; a described process is not.
