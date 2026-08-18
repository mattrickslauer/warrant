# Infrastructure — scale to zero, or as close as the service allows

The target is **near-zero cost at rest.** Nothing should bill while nobody is using it, and the
one component that cannot behave that way is named below so it does not surprise us.

---

## Deploy the landing page

```bash
./scripts/deploy-site.sh
```

Cloud Run, `min-instances=0`, `max-instances=4`, 256Mi, CPU throttled outside requests. An
nginx:alpine image of about 12MB with a sub-second cold start. **No request, no container, no
charge.**

Cloud Run was chosen over Firebase Hosting for one specific reason: the rules accept *"URL of
.run"* and the *"Cloud Run dashboard"* as proof the project is deployed on Google Cloud. A
`.run.app` URL is a scored artifact, and using one platform for the site and the API keeps the
deploy story to a single sentence.

Custom domain, once it exists:

```bash
gcloud beta run domain-mappings create --service warrant-site --domain fillitin.ink --region us-central1
```

---

## Cost posture, service by service

| Service | Setting | At rest |
|---|---|---|
| **Cloud Run** (site, API, MCP) | `min-instances=0`, `--cpu-throttling`, `max-instances` capped | **$0** |
| **Firestore** | Native mode, no minimum | Free tier: 1 GiB, 50k reads / 20k writes a day |
| **Pub/Sub** | Standard topics | Free tier: 10 GB/month |
| **Cloud Storage** (evidence media) | Standard, lifecycle rule deleting objects after 90 days | Pennies |
| **Cloud Logging** | Retention cut to 30 days | Free tier: 50 GiB/month |
| **Gemini 3.5 Flash** | Per token | Only when a step is verified |
| **Gemma** | Routed the bulk of routine evidence | Fraction of Flash |
| **Model Armor** | Per screening call | Only on capture |
| **Artifact Registry** | Container images | Set a cleanup policy — old images bill silently |

### The one that does not scale to zero

**Agent Engine.** A long-running agent runtime is the opposite of scale-to-zero by design —
that is what makes it able to hold context across weeks of asynchronous operation, and it is
the reason the category asks for it.

**Confirm its billing model in the console hour before deploying nine agents to it.** If it
bills for provisioned runtime rather than per-invocation, deploy the agents that genuinely need
long-lived state (Scoper, Inspector, Quartermaster, Gatekeeper) and run the rest as Cloud Run
services triggered by Pub/Sub. Same architecture, a fraction of the resting cost.

---

## Guardrails against a surprise bill

**Claim the credits.** $150 in Google Cloud credits, one per entrant, via the hackathon form —
**the form closes 28 Aug at 12:00 PT.** That covers this project several times over.

**Set a budget with alerts** on the project immediately:

```bash
gcloud billing budgets create \
  --billing-account="$(gcloud billing projects describe "$(gcloud config get-value project)" --format='value(billingAccountName)' | cut -d/ -f2)" \
  --display-name="warrant" \
  --budget-amount=50USD \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0
```

**Budgets alert, they do not stop.** A hard cap requires a Pub/Sub topic on the budget and a
function that disables billing. For a two-week project, alerts plus `max-instances` caps plus
the Treasurer's own ceiling are proportionate; a runaway agent loop is a far likelier cause of
a bill than traffic.

**Cap the agents, not just the infrastructure.** The Treasurer holds a hard spend ceiling per
job and refuses past it. That is the control that matters, because the expensive resource here
is model calls, not compute.

---

## Regions

| Concern | Region | Why |
|---|---|---|
| Cloud Run, Firestore, Pub/Sub | `us-central1` | Cheapest, everything available |
| **Model Armor** | **`us` multi-region** | Image modality only works in the `us` and `eu` multi-regions — see `architecture.md` §8 |

That split is deliberate and it is the one thing likely to be forgotten. A Model Armor template
in `us-central1` fails silently with no error at all.
