# Feature Specification: Persistent Source and Cast Confirmation

**Feature Branch**: `002-persistent-source-confirmation`

**Created**: 2026-10-07

**Status**: Draft

**Input**: User description: "Persistent Source Revision and cast/alias confirmation before storyboard staging. A pasted Russian dialogue and its project survive refresh and restart. Material review lets the user edit the draft before its first commit, confirm characters and aliases, and resolve speaker ownership. Confirmation creates an immutable Source Revision and ordered Interpretation. The existing storyboard flow receives that confirmed material. Unresolved speaker ownership blocks staging."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Resume the saved draft (Priority: P1)

A person who already has a nearly finished Russian dialogue pastes it into the project. The draft may include context, directions, silent actions, aliases, and informal notes. The project keeps that draft. Refreshing the page, or stopping the application and starting it again, restores the same project and the same draft text, including an edit made before the first commit.

**Why this priority**: The current storyboard tracer keeps the paste only until the page is left. A confirmation gate is not trustworthy if the material disappears before the user can review it.

**Independent Test**: Paste a multi-line Russian dialogue, change one character in the draft, refresh the page, then stop and start the application. The project opens on that edited draft. No Source Revision exists yet.

**Acceptance Scenarios**:

1. **Given** an empty project, **When** the user pastes a nearly finished Russian dialogue, **Then** the draft is saved and remains available in that project.
2. **Given** a saved draft that has not been committed, **When** the user refreshes the page, **Then** the same project opens with the draft text unchanged, character for character.
3. **Given** a saved uncommitted draft, **When** the application is stopped and started again, **Then** the same project opens with that same draft text.
4. **Given** an uncommitted draft, **When** the user edits it and then refreshes or restarts, **Then** the edited text is restored and no committed Source Revision has been created.

---

### User Story 2 - Confirm characters, aliases, and speaker ownership (Priority: P1)

The user asks for a reading of the current draft. The reading preserves the draft wording and extracts one ordered sequence of source items, provisional characters, aliases and other surface forms, and the speaker ownership of each spoken item. Material review shows the editable draft, the extracted characters, the proposed alias mappings, the speaker ownership, and the blocking findings. The user can correct the cast before staging. Confirming the material commits an immutable Source Revision and the ordered Interpretation of that exact text, together with the canonical mappings the user accepted.

`Дмитрий Сергеевич` can be mapped explicitly to `Песков`. That correction does not rewrite the draft.

**Why this priority**: Staging should receive a cast the user has accepted. The reference dialogue showed that an address and a canonical person can otherwise remain disconnected.

**Independent Test**: Use a draft that contains an explicit speaker, one address that uses a different surface form, and one spoken line with no resolvable speaker. Confirm the alias mapping, leave the unresolved line unresolved, and commit. The committed text matches the draft. The unresolved line is still visible as a blocking finding.

**Acceptance Scenarios**:

1. **Given** a loosely structured Russian draft, **When** the user requests a reading, **Then** Material review shows ordered source items, provisional characters, proposed aliases, and speaker ownership without changing the draft text.
2. **Given** a draft that contains both `Дмитрий Сергеевич` and `Песков`, **When** the user maps that surface form to `Песков`, **Then** the canonical mapping is `Дмитрий Сергеевич` → `Песков` and the draft text is unchanged.
3. **Given** a reading that matches the current draft and at least one spoken item with no confirmed speaker, **When** the user confirms the material, **Then** an immutable Source Revision and its ordered Interpretation are stored, the accepted mappings are stored, and the unresolved spoken item remains a visible blocking finding.
4. **Given** an uncommitted draft, **When** the user edits the draft after the last reading, **Then** the mismatch is visible, confirmation is unavailable until the user requests a reading of the edited text, and no Source Revision is created by the edit itself.
5. **Given** a draft whose speakers are already explicit, **When** the user confirms the proposed cast without correcting it, **Then** Material review does not ask a follow-up content question and does not present a non-blocking finding.

---

### User Story 3 - Stage only from confirmed material (Priority: P1)

After confirmation, the user can request the existing storyboard. Staging receives the confirmed source items and the canonical character and alias mappings. It uses the confirmed relationship for `Дмитрий Сергеевич` and `Песков` as an input. Spoken dialogue is still reconstructed from the source. A confirmed alias does not replace those spoken words.

Unresolved speaker ownership blocks staging and explains which spoken material is unresolved. A ready storyboard is not shown. Assigning the missing speaker, without changing the source text, clears that block and does not create another Source Revision.

A storyboard that preserves the source may still be artistically imperfect. That imperfection does not block readiness. A source-fidelity failure still does.

**Why this priority**: Confirmation matters only if the storyboard is built from the confirmed material, and only if unresolved ownership cannot pass as ready.

**Independent Test**: Start from a confirmed revision that maps `Дмитрий Сергеевич` to `Песков` and has one unresolved speaker. Staging is blocked and names that spoken item. Assign the speaker, stage again, and verify that the supplied material still contains the alias mapping, the spoken words are unchanged, and the committed source text is unchanged.

**Acceptance Scenarios**:

1. **Given** a confirmed mapping `Дмитрий Сергеевич` → `Песков`, **When** the user stages the storyboard, **Then** staging is given the confirmed source items and that canonical mapping, and the spoken dialogue still contains `Дмитрий Сергеевич` exactly where the source contains it.
2. **Given** a confirmed revision with one spoken item that has no canonical speaker, **When** the user requests a storyboard, **Then** staging is blocked, the explanation identifies that spoken material, and no ready storyboard is shown.
3. **Given** that blocked revision, **When** the user assigns a canonical speaker without editing the source text, **Then** that item's blocking finding is cleared, the same Source Revision remains committed, no new Source Revision is created, and staging can proceed.
4. **Given** a confirmed, fully resolved dialogue whose storyboard preserves source wording and order but uses imperfect artistic judgement, **When** staging completes, **Then** the storyboard is shown as ready.
5. **Given** a storyboard that drops, duplicates, reorders, or changes source dialogue, **When** the result is checked, **Then** each of those defects blocks readiness on its own and no ready storyboard is shown.

---

### User Story 4 - Keep the previous source recoverable (Priority: P2)

After the first commit, the user can edit the source text. The edit is saved as the working draft. Confirming a fresh reading of that edited text creates a new Source Revision and a new Interpretation. The previous revision stays unchanged and can be viewed again with its exact text, interpretation, canonical mappings, and storyboard result if one was produced.

A cast correction that does not change the source text updates the confirmed mappings on the current revision. It does not create a new Source Revision.

**Why this priority**: The user needs a durable history once the source has been committed, while still being free to correct a name or a speaker without pretending the dialogue changed.

**Independent Test**: Commit a draft, change one punctuation mark, confirm the new reading, and view the previous revision. Its original text is intact. Separately, change only an alias mapping and confirm that the committed text and revision count are unchanged.

**Acceptance Scenarios**:

1. **Given** a committed Source Revision, **When** the user changes the source text, including punctuation or whitespace, requests a new reading, and confirms it, **Then** a new Source Revision and Interpretation are stored and the previous text remains available character for character.
2. **Given** two committed revisions, **When** the user views the earlier revision, **Then** its exact text, ordered interpretation, canonical mappings, and any storyboard produced for it are visible, and the active revision and working draft stay unchanged.
3. **Given** a later committed revision with an uncommitted working edit, and an earlier revision that already has a storyboard produced from its own mappings, **When** the user makes the earlier revision active, **Then** the working draft becomes that earlier revision's committed text, that storyboard is the current ready result, the later revision remains stored, and the abandoned working edit is not recoverable.
4. **Given** a committed revision with a ready storyboard, **When** the user changes only an alias mapping or a speaker assignment, **Then** no new Source Revision is created. The existing storyboard remains visible as the previous result and is not labeled ready for the updated mappings until the user stages again.
5. **Given** a project whose active revision has a ready storyboard, **When** the user refreshes the page or restarts the application, **Then** the project resumes on that confirmed material and that ready storyboard.

---

### Edge Cases

- An empty draft, or a draft with no source-authored material, can be saved. It cannot be confirmed or staged. The explanation is visible, and no Source Revision is created.
- A reading that fails or is interrupted leaves the draft saved, creates no Source Revision, and does not show a ready storyboard. The user can request the reading again.
- Refreshing before the first successful reading restores the draft and does not invent characters, aliases, or a storyboard.
- Before the first commit, a series of draft edits leaves no earlier committed revision to recover.
- An uncommitted working draft is restored after refresh and restart. Viewing another committed revision leaves that working draft in place. Making another committed revision active replaces the working draft with that revision's text. The abandoned uncommitted edit is not a revision and is not kept.
- A speaker label, an address, and a mention may refer to the same canonical character. An address or mention remains inside the spoken source text. It does not become a speaker unless the user assigns that speaker.
- The user can map a surface form that occurs in the draft even when the reading did not propose that mapping. The draft wording stays unchanged.
- The user can merge two provisional characters into one canonical character, or point one surface form at a different canonical character, including a character named during review.
- Several source items may come from one physical line. Their relative order follows the draft.
- Notes, directions, and silent actions stay source items. They do not become spoken lines unless the source presents them as dialogue.
- A mapping-only correction after a storyboard has been shown keeps those frames visible as the previous result. They are not labeled ready for the updated mappings.
- An artistically imperfect but source-faithful storyboard remains ready. This feature does not ask for another staging attempt in order to improve directing.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The user MUST be able to paste one nearly finished Russian dialogue into one saved project. The draft MUST accept loosely structured text, including optional context, directions, silent actions, aliases, and informal notes. A `Character: line` form is not required.
- **FR-002**: The project and its working draft MUST survive page refresh and an application restart. The restored draft MUST match the saved draft character for character.
- **FR-003**: Before the first Source Revision is committed, draft edits MUST be saved and MUST NOT create a committed revision.
- **FR-004**: The user MUST be able to request a reading of the current draft. The reading MUST preserve the draft and MUST extract ordered source items, provisional characters, aliases and other surface forms, and speaker ownership for each spoken item. Speaker ownership MAY be explicit, provisionally inferred, or unresolved.
- **FR-005**: Source items MUST distinguish spoken utterances, actions, context, and notes. Several items MAY share one physical line. Item order MUST follow the draft. Exact draft wording and source order remain authoritative.
- **FR-006**: Material review MUST show the editable draft, the extracted characters, the proposed alias mappings, the speaker ownership, and the blocking findings for the current reading.
- **FR-007**: The only blocking finding in Material review is a spoken item with no confirmed canonical speaker. Each such finding MUST identify that spoken material by its source wording. The screen MUST NOT present non-blocking findings and MUST NOT ask follow-up content questions.
- **FR-008**: The user MUST be able to rename a canonical character, merge provisional characters, assign a spoken item to a canonical character, and map a surface form that occurs in the draft to a canonical character. The surface form `Дмитрий Сергеевич` MUST be mappable to `Песков`. None of these actions changes the draft wording.
- **FR-009**: The user MUST be able to confirm the current material only when its reading matches the current draft character for character. Confirmation MUST create one immutable Source Revision and the ordered Interpretation of that exact text, and MUST store the canonical character and alias mappings accepted at that moment.
- **FR-010**: A later change to canonical names, alias mappings, or speaker assignments, with no change to the committed source text, MUST update the confirmed cast of that Source Revision and MUST NOT create another Source Revision or Interpretation.
- **FR-011**: After the first commit, an edit to the source text, including punctuation or whitespace, MUST be saved as the working draft. Confirming a new reading of that edited text MUST create a new Source Revision and Interpretation. The previous revision MUST remain unchanged.
- **FR-012**: The user MUST be able to view a previous Source Revision, including its exact text, ordered Interpretation, canonical mappings, and storyboard result when one was produced. Viewing it MUST leave the active revision and working draft unchanged. The user MUST also be able to make a previous revision active. That choice loads its committed text as the working draft and MUST NOT destroy any stored revision.
- **FR-013**: Storyboard staging MUST be available only for the active confirmed Source Revision. Staging MUST receive that revision's ordered source items and its current canonical character and alias mappings, including a confirmed mapping from `Дмитрий Сергеевич` to `Песков`.
- **FR-014**: Displayed dialogue MUST continue to be reconstructed from source references. A canonical alias mapping MUST NOT replace or rewrite spoken source wording.
- **FR-015**: Unresolved speaker ownership MUST block staging. The visible explanation MUST identify each unresolved spoken item. No ready storyboard is shown. Assigning a canonical speaker without a source-text change MUST clear that item's block without creating a Source Revision.
- **FR-016**: Existing source-fidelity validation MUST remain blocking. Missing, duplicated, reordered, or changed source dialogue, and any source-authored item that is not accounted for, MUST each block a ready storyboard.
- **FR-017**: A source-faithful storyboard MUST be presentable as ready when its artistic judgement is imperfect. This feature does not grade or improve staging artistry.
- **FR-018**: Refresh and application restart MUST restore the active confirmed material. A ready storyboard produced from the current revision and the current canonical mappings MUST be restored with it and labeled ready. A storyboard produced before a later mapping change MUST remain available as the previous result and MUST NOT be labeled ready for the updated mappings.
- **FR-019**: A reading failure, an empty draft, or a draft with no source-authored material MUST remain visible as a failure to confirm or stage. The saved draft MUST remain, and no Source Revision or ready storyboard is created.

### Key Entities

- **Project**: The one saved local project. It holds the working draft, the committed source history, the confirmed cast, and any storyboard result tied to a revision.
- **Working draft**: The editable source text. It is authoritative for exact wording and order. Before the first commit it has no revision history. After a commit it may differ from the active Source Revision until the user confirms a new reading.
- **Source Revision**: An immutable committed snapshot of the draft text, with a link to the revision it was confirmed from. Its text never changes after commit.
- **Interpretation**: The immutable ordered reading of one Source Revision: source items, provisional characters, proposed surface forms, and provisional speaker ownership. It refers to the source text. It is not a second copy of the dialogue.
- **Canonical cast**: The accepted characters, alias mappings, and speaker assignments for one Source Revision. Staging uses this cast. A cast update without a text change stays on the same revision.
- **Blocking speaker finding**: A spoken source item that does not yet have a confirmed canonical speaker. It is the only finding Material review presents.
- **Storyboard result**: The existing read-only storyboard, or its blocking or failed outcome, produced from one confirmed revision and one canonical cast.

### Out of Scope

- Frame editing, split or single changes, reorder, add, delete, frame-scoped regeneration, and undo.
- Image generation, a Visual storyboard, timing, and video.
- Accounts, collaboration, public deployment, and private links.
- A project list, project deletion, and an external retention policy.
- Non-blocking preflight findings, including option sets, contradictions that do not change speaker ownership, and marking a finding intentional.
- Repair loops and automatic improvement of dialogue wording.
- Artistic prompt optimization, and any change to the existing provider adapter, frame presentation, overflow handling, or artistic-evaluation baseline.
- Introducing or title sequences, character photographs, and likeness details.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For both a fresh paste and a later uncommitted edit, page refresh and an application restart each restore the working draft with every character unchanged.
- **SC-002**: After confirmation, page refresh and an application restart each restore the same committed text, the same source-item order, and the same canonical mappings.
- **SC-003**: In the `Дмитрий Сергеевич` / `Песков` example, the confirmed mapping is present in the material supplied to staging, and the spoken dialogue still matches the source slice character for character.
- **SC-004**: Each spoken item without a confirmed speaker blocks staging on its own, is identified on screen, and produces no ready storyboard. Assigning that speaker without a text change adds no Source Revision.
- **SC-005**: Confirming a punctuation-only or whitespace-only source edit creates one new Source Revision. The previous revision's text remains viewable character for character.
- **SC-006**: Before the first confirmation, draft edits create no recoverable Source Revision.
- **SC-007**: Each seeded loss, duplication, reordering, and wording change still blocks readiness individually.
- **SC-008**: A fully resolved, source-faithful dialogue can be confirmed and shown as a ready storyboard without a follow-up content question, including when the storyboard's artistic judgement is imperfect.
- **SC-009**: When every spoken item has a confirmed speaker, Material review shows no blocking finding. Across the acceptance scenarios, it shows no finding of any other kind.

## Assumptions

- This feature continues the accepted ready-dialogue path. The user already has a nearly finished Russian dialogue. The application does not invent a story from a blank prompt.
- The saved work is one local project. Opening the application resumes that project. A project list, sign-in, and private links belong to later work.
- The accepted local-first direction supplies the durability above: the project is stored outside the running application with PostgreSQL, and local startup may use Docker Compose. The scenarios do not ask the user to operate either one. Remote deployment remains outside this feature.
- A recommended `Character: line` form may appear in a draft. Explicit speaker labels are used when they are present. Otherwise the reading may infer a speaker. Unresolved ownership stays visible until the user assigns a canonical speaker.
- An alias or form of address identifies a person. It does not by itself decide who speaks. Speaker ownership is confirmed separately.
- The first confirmation has no parent revision. Each later text confirmation records the revision it started from.
- Choosing an earlier revision as the active revision loads its committed text as the working draft. Other revisions stay stored.
- The storyboard staged from confirmed material keeps the current read-only storyboard behavior: exact dialogue comes from source references, source-fidelity failures block readiness, and the existing frame presentation and overflow handling stay in place.
- The existing server-side provider path performs the reading and the staging. This feature does not change that adapter, the staging prompt, or the artistic-evaluation baseline. No live provider request is required to accept this specification.
- The unfilled SpecKit constitution scaffold does not add product principles for this feature.
