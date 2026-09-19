# Product context and open questions

Written 2026-09-20. This document is for **product-level discussion only**. It is not an
implementation brief, and nothing here is approved scope.

For technical state and the current experiment plan, see `docs/HANDOFF.md`. Do not start
implementation work from this file.

---

## 1. What the product is

A user enters one prompt describing a story or situation, attaches photographs of the people who
should star in it, and receives a short illustrated video: stylised cel-shaded portraits of those
people, in comic-book style, speaking typed dialogue to each other.

Server side does the AI-intensive work — interpreting the prompt, writing the script, directing the
scenes, planning and generating character images, validating them, and packaging a project bundle.
The client renders the video locally from that bundle.

The reference artifact is a 158-second video made by hand in September 2026 (three real people,
sixteen images, hand-written scene list). It demonstrates the target output quality. It does **not**
demonstrate that any of it can be automated — that is what the current experiment is testing.

## 2. Settled, do not relitigate without a reason

- No generative video, no lip sync, no full-body animation, no arbitrary camera movement.
- No voice synthesis. Dialogue is typed text.
- **No audio at all.** Music and sound are out of product scope. (Noted: the reference video was
  judged to work without music, though a tuned track did improve it. Revisit only deliberately.)
- Apple platforms only for now. Android and Windows renderers are dropped from planning.
- One visual style to start. Additional styles are data, not code.
- Two human approval gates: base portrait per character, then the storyboard.
- The pipeline is being built and tuned against placeholder assets, before any image generation.
- Style presets are described by visual attributes, never by franchise name — hosted image APIs
  degrade or refuse on named-IP prompts, and a preset named after someone else's property is a
  liability in a shipping product.

## 3. Open product questions, roughly by consequence

### 3.1 The pitch contradicts the safety policy

The reference video's own selling proposition is celebrity and political conflict — Messi versus
Ronaldo, Democrats versus Republicans, a musician versus a rapper, delivered as the punchline. That
is simultaneously the most compelling demo and the highest-risk content category. Every hosted image
API forbids depicting identifiable real people without consent, political figures especially.

So the pitch as demonstrated cannot be delivered on hosted models. The options are self-hosting and
owning the compliance burden, or changing the pitch. **This is the largest unresolved product
decision and it constrains the compute choice, the marketing, and the moderation design.**

### 3.2 Consent for people who are not the user

The primary use case is uploading photographs of friends, colleagues, and public figures. A
self-certification checkbox from the uploader is not a lawful basis for processing another person's
biometric data in the EU or several US states. Needs a real answer, not a checkbox.

Related and already noted technically: identity-consistency checking by face embedding produces
biometric data. Computing it in memory and persisting only the score is the mitigation; persisting
vectors is not acceptable.

### 3.3 Can a franchise style be marketed at all?

Internally the first style is described by attributes. The product question is separate: can the
marketing say "GTA style", "Marvel style"? Almost certainly not by name. What does the user-facing
style picker actually say, and does the product survive without naming the references users
recognise?

### 3.4 What can the user change at the storyboard gate?

Currently undefined. If the user can only approve or restart, restart discards every generated
image — the entire cost of the job — and the review will feel punitive.

Editing dialogue text and rerolling which existing expression a scene uses are both **free**: they
reuse assets and require no image generation. Allowing them is high value at near-zero cost. Needs a
decision about where the boundary sits between free edits and edits that trigger regeneration.

### 3.5 Unit economics

Estimated 15–60 image generations per video once retries and best-of-N are included, so roughly
$1–10 per video at current API pricing, dominated by retries. Latency 3–10 minutes.

Undecided: pricing model, free-tier shape, what a user is charged for when likeness is rejected
repeatedly, and whether the retry cost is absorbed or exposed.

Note that the Director's expression-sheet size is the main cost lever — images per video is roughly
the whole bill. That is why expression-sheet economy is a primary metric in the experiment.

### 3.6 Is local rendering a feature or a demo trick?

It saves egress, storage, and a server render fleet. It costs a renderer per platform, and it means
the user cannot share a link until they render locally and upload.

The demo sells local rendering as the differentiator, and it is genuinely novel. But video encoding
was never the expensive part — images are. With Android and Windows now out of scope, the
cross-platform argument for a neutral bundle format is weaker than when it was written. Worth
re-examining honestly rather than inheriting.

### 3.7 Sharing and the growth loop

Currently absent. If the video exists only on device, how does anyone else see it? This is the
distribution mechanism for a product whose entire appeal is showing people to themselves and their
friends. Interacts directly with 3.6.

### 3.8 Who is the first user?

Unstated. The reference video is a competition pitch, which is not a use case. Candidate audiences —
meme makers, people making birthday videos for friends, teams making internal jokes, creators
producing short-form content — imply materially different durations, cast sizes, styles, tones, and
willingness to wait 10 minutes.

### 3.9 Does the approval-gate flow match the latency?

Two gates plus 3–10 minutes of generation is not a "tap and wait" experience. The gates make the
latency defensible, but it implies an async model with notifications, resumable jobs, and a project
list — a heavier app than a single-screen generator. Confirm this is the intended shape.

### 3.10 Scope boundaries worth re-deriving rather than inheriting

Current assumptions: 1–3 characters, 30–180 seconds, 4–8 expressions per character, frontal or
near-frontal reference photographs. These came from the reference video's shape, not from a user.
Each is a constraint on what stories are tellable.

## 4. Useful facts for product reasoning

- The reference video's pace is **9.5 lines per minute**, about **5.7 seconds per line**. So a
  60-second video is roughly 6–7 spoken lines after a cast intro. Short videos are very short.
- Image reuse in the reference: 16 images for 24 lines across 24 scenes — a reuse factor of 2.5.
  Asset economy is a stylistic feature, not only a cost saving. The cutscene that inspired the format
  holds a single unchanged portrait for twelve seconds across two sentences and reads as confident.
- The genuinely hard, human-owned problem is likeness: eye spacing, brow weight, jaw shape, apparent
  age. The oracle is a person who has seen the subject. This is why the base-portrait gate exists and
  why it cannot be automated away.
- Cartoon styling is load-bearing engineering, not only taste: flat cel shading tolerates geometric
  error and composites cleanly at a mask boundary, which photoreal would not.

## 5. How to use this document

Discussion, options, trade-offs, and recommendations. Where a decision is made, record it with its
rationale and the rejected alternatives. Do not write code, modify schemas, or change the experiment
plan from this conversation.
