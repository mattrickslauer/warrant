# Research Catalog

The single index of external research Rotation draws on. Every paper we fetch gets one
entry here, and the fetched source is stored alongside it under `papers/`.

**One catalog, one file.** Do not start a second index. Append new entries to the bottom
of [Entries](#entries) and add a row to the [Index](#index) table.

### How to add a paper

```bash
./scripts/fetch_paper.sh 2604.22925        # arXiv ID; downloads PDF + HTML into docs/research/papers/
```

Then write an entry using the template at the end of this file. Fill **Relevance to
Rotation** honestly — if a paper does not change what we build, say so. A catalog of
things we merely found interesting is worth nothing.

Keep the three fact classes from the README straight in these notes: what a paper
**measured**, what it **inferred**, and what it **asserted**. A result reproduced on 90
songs is not a law.

---

## Index

| # | Short name | Title | Venue / ID | Year | Relevance |
|---|---|---|---|---|---|
| 001 | Come Together | Analyzing Popular Songs Through Statistical Embeddings | arXiv:2604.22925 [stat.AP] | 2026 | High — embedding + similarity design for Profiler/Matchmaker |

---

## Entries

### 001 — Come Together: Analyzing Popular Songs Through Statistical Embeddings

| Field | Value |
|---|---|
| **Authors** | Matthew Esmaili Mallory (Harvard, Statistics); Mark Glickman (Harvard, Statistics); Jason Brown (Dalhousie, Mathematics & Statistics) |
| **ID** | arXiv:2604.22925v1 |
| **Category** | stat.AP (Statistics — Applications) |
| **Date** | Submitted 24 Apr 2026 (preprint header dated 28 Apr 2026) |
| **Length** | 4 pp. preprint |
| **Source** | <https://arxiv.org/abs/2604.22925> |
| **Local copy** | [`papers/2604.22925.pdf`](papers/2604.22925.pdf), [`papers/2604.22925.html`](papers/2604.22925.html) |
| **Keywords** | Feature representation · Lennon and McCartney · Logistic PCA · Popular music · Song structure |
| **Fetched** | 2026-08-17 |

#### Abstract (verbatim)

> Statistical modeling of popular music presents a unique challenge due to the complexity
> of song structures, which cannot be easily analyzed using conventional statistical tools.
> However, recent advances in data science have shown that converting non-standard data
> objects into real vector-valued embeddings enables meaningful statistical analysis. In
> this work, we demonstrate an approach based on logistic principal component analysis to
> construct embeddings from global song features, allowing for standard multivariate
> analysis. We apply this method to a corpus of Lennon and McCartney songs from 1962-1966,
> using embeddings derived from chords, melodic notes, chord and pitch transitions, and
> melodic contours. Our analysis explores how these song embeddings cluster by Beatles
> album, how songwriting styles evolved over time, and whether Lennon and McCartney's
> compositions exhibited convergence or divergence. This embedding-based approach offers a
> powerful framework for statistically examining musical structure and stylistic
> development in popular music.

#### What it does

Songs are encoded as binary feature vectors — presence/absence of harmonic and melodic
events — and then reduced to a real-valued embedding with **logistic PCA**, which is PCA
adapted to Bernoulli data by projecting the natural parameters rather than the raw 0/1
values. Once a song is a point in Euclidean space, ordinary multivariate tools apply:
centroids per album, distances between authors, clustering, classification.

**Feature construction** — 137 binary features in five families:

| Family | Detail |
|---|---|
| Pitches | Presence of individual melodic notes |
| Chords | The seven diatonic chords get their own features; non-diatonic chords are grouped |
| Pitch transitions | Melodic interval movement |
| Harmonic transitions | Chord-to-chord movement, incl. non-diatonic→non-diatonic |
| Contours | Local melodic shape, 3³ = 27 features |

Melodic and harmonic features are transposed to a standard key first (following Glickman
et al. 2019), so the representation is key-invariant.

**Corpus** — a 90 × 137 matrix: Lennon and McCartney songs 1962–1966, plus eight Harrison
songs and a handful jointly written, unknown, or disputed.

**Fitting** — the logistic PCA truncation parameter *m* is chosen by cross-validation over
*m* ∈ {1..10}, selecting **m = 3**. **35 principal components** are retained (~80% of
variation). Implemented in R.

#### Results

| Finding | Evidence |
|---|---|
| Lennon and McCartney album centroids **converge** over 1962–1966 | Centroids start at opposite ends of PC1 and move toward the centre across albums — running against the usual narrative of diverging styles |
| Within-album stylistic **variance rises** for both | Both writers follow a similar trajectory of increasing spread over time |
| Harrison sits at a **stable distance from McCartney**, a fluctuating one from Lennon | Distances from Harrison's 8 songs to each album-specific centroid; no clear trend up or down over time |
| Authorship is **partly** recoverable from the embedding | k-means (k=2) ≈ 70%; logistic regression on 35 PCs, leave-one-out ≈ **72%**; KNN (k=5) ≈ 69%; random forest (1000 trees, mtry 6) ≈ 66% |
| Disputed songs get **consistent** predictions | Logistic regression, KNN, and RF mostly agree with each other and with Glickman et al. (2019) |

The 72% figure is roughly in line with the 75.7% reported by Glickman et al. (2019) using
the features directly — i.e. the embedding compresses 137 dimensions to 35 without paying
much accuracy for it. That is the actual claim worth carrying.

#### Relevance to Rotation

**High — this is the closest published analogue to what the Profiler and Matchmaker do.**

1. **It validates the core bet.** Rotation's index is built on the premise that a fixed
   real-valued embedding of a record supports meaningful distance comparisons. This paper
   demonstrates exactly that on musical structure, with a measurable outcome (authorship
   accuracy) rather than a visual argument.

2. **Binary → real is the right shape for our curator profiles.** A curator profile is
   naturally sparse and binary — plays this format, accepts unsigned artists, ran this
   genre last quarter. Logistic PCA is the principled reduction for that data, and it is
   cheaper and far more interpretable than an embedding model. Worth benchmarking against
   whatever the Profiler currently emits before we commit to a heavier approach.

3. **Centroids are a usable primitive for the Matchmaker.** "Distance from this record to
   a show's centroid, over time" is precisely the Harrison analysis, pointed at a different
   question. It also gives us drift detection: a show whose centroid has moved needs
   re-profiling.

4. **Interpretability we can put in `explain_match`.** PCA components can be read back to
   the features that load on them, so a match reason can name a musical property instead
   of citing a similarity score. That matters for the MCP surface, where a curator asks
   *why* a record was matched.

5. **Compression ratio is the practical lesson.** 137 → 35 dimensions at near-parity
   accuracy is a direct argument for keeping the AlloyDB/ScaNN vectors small.

**Where it does not carry over:**

- The corpus is 90 songs from one band over four years. Nothing here establishes that
  these dimensions generalise across genres, eras, or production styles.
- Features are hand-built from scores and transposed to a standard key. Rotation derives
  its facts from **audio**, via Gemini — a different and noisier input path. This paper
  says nothing about how well the representation survives that.
- Authorship attribution is a two-class problem with a balanced corpus. Curator matching
  is ranking against tens of thousands of candidates. The accuracy figures do not transfer.
- ~70% accuracy is a research result, not a product threshold. If the Filter passed a
  candidate on 72% confidence it would be sending noise.

**Actions:**
- [ ] Benchmark logistic PCA on the Profiler's binary curator features as a baseline
      against the current embedding
- [ ] Prototype centroid-drift detection as a Profiler re-crawl trigger
- [ ] Investigate loading-based explanations as an input to `explain_match`

#### Cited work worth chasing

| Reference | Why |
|---|---|
| Glickman et al. (2019) | The direct predecessor — same corpus, features used raw, 75.7% attribution. Our baseline comparison. |
| Burgoyne et al. (2013) | Harmonic structure of pop music at corpus scale |
| Thickstun et al. (2017) | Learned features across musical genres |
| Bergomi (2015) | Computational topology applied to voice leading |
| Boehmke & Greenwell (2019) | Source of the k = √n/2 KNN heuristic used here |

---

## Entry template

```markdown
### NNN — Title

| Field | Value |
|---|---|
| **Authors** | |
| **ID** | |
| **Category** | |
| **Date** | |
| **Source** | |
| **Local copy** | [`papers/....pdf`](papers/....pdf) |
| **Fetched** | YYYY-MM-DD |

#### Abstract (verbatim)

> ...

#### What it does

#### Results

#### Relevance to Rotation

**High / Medium / Low / None — one sentence saying why.**

**Where it does not carry over:**

**Actions:**
- [ ] ...

#### Cited work worth chasing
```
