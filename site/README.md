# site/ — superseded

This held the original static landing page, deployed to Cloud Run as `warrant-site`.

It has been replaced by the Next.js app in [`../web`](../web):

- **`/`** is the product — a task carousel a stranger can use with no account
- **`/about`** is the explainer this page used to be

The old page also carried two defects that could not ship: it listed **nine agents**,
including core services that contain no model, and it stated *"None of them calls another"*,
which contradicts the delegation the Foreman exists to do. Its courier illustration was also
built from third-party logos, and the contest rules bar third-party trademarks from a
submission.

Deploy the app with [`../infra/deploy-web.sh`](../infra/deploy-web.sh).
