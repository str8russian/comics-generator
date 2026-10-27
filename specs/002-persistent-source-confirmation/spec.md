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

The user asks for a reading of the current draft. The reading preserves the draft wording and extracts one ordered sequence of source items, provisional characters, aliases and other surface forms, and the speaker ownership of each spoken item. Material review shows the editable draft, the extracted characters, the proposed alias mappings, the speaker ownership, and the blocking findings. The user can correct the cast before staging. Confirming the material commits an immutable Source Revision and the ordered Interpretation of that exact text, and stores the accepted canonical mappings as the first material state for that revision.

`Дмитрий Сергеевич` can be mapped explicitly to `Песков`. That correction does not rewrite the draft.

**Why this priority**: Staging should receive a cast the user has accepted. The reference dialogue showed that an address and a canonical person can otherwise remain disconnected.

**Independent Test**: Use a draft that contains an explicit speaker, one address that uses a different surface form, and one spoken line with no resolvable speaker. Confirm the alias mapping, leave the unresolved line unresolved, and commit. The committed text matches the draft. The unresolved line is still visible as a blocking finding.

**Acceptance Scenarios**:

1. **Given** a loosely structured Russian draft, **When** the user requests a reading, **Then** Material review shows ordered source items, provisional characters, proposed aliases, and speaker ownership without changing the draft text.
2. **Given** a draft that contains both `Дмитрий Сергеевич` and `Песков`, **When** the user maps that surface form to `Песков`, **Then** the canonical mapping is `Дмитрий Сергеевич` → `Песков` and the draft text is unchanged.
3. **Given** a reading that matches the current draft and at least one spoken item with no confirmed speaker, **When** the user confirms the material, **Then** an immutable Source Revision and its ordered Interpretation are stored, the accepted mappings are stored as the first material state for that revision, and the unresolved spoken item remains a visible blocking finding.
4. **Given** an uncommitted draft, **When** the user edits the draft after the last reading, **Then** the mismatch is visible, confirmation is unavailable until the user requests a reading of the edited text, and no Source Revision is created by the edit itself.
5. **Given** a draft whose speakers are already explicit, **When** the user confirms the proposed cast without correcting it, **Then** Material review does not ask a follow-up content question and does not present a non-blocking finding.

---

### User Story 3 - Stage only from confirmed material (Priority: P1)

After confirmation, the user can request the existing storyboard. Staging receives the confirmed source items and the canonical character and alias mappings. It uses the confirmed relationship for `Дмитрий Сергеевич` and `Песков` as an input. Spoken dialogue is still reconstructed from the source. A confirmed alias does not replace those spoken words.

Unresolved speaker ownership blocks staging and explains which spoken material is unresolved. A ready storyboard is not shown. Assigning the missing speaker, without changing the source text, clears that block. That assignment creates a new material state for the same Source Revision and Interpretation. It does not create another Source Revision or Interpretation.

A storyboard that preserves the source may still be artistically imperfect. That imperfection does not block readiness. A source-fidelity failure still does.

**Why this priority**: Confirmation matters only if the storyboard is built from the confirmed material, and only if unresolved ownership cannot pass as ready.

**Independent Test**: Start from a confirmed material state that maps `Дмитрий Сергеевич` to `Песков` and has one unresolved speaker. Staging is blocked and names that spoken item. Assign the speaker and check that the source text and Interpretation are unchanged, a new material state exists, and the earlier mapping state is still distinguishable. Stage again and verify that the new result is tied to that corrected material state, the supplied material still contains the alias mapping, and the spoken words are unchanged.

**Acceptance Scenarios**:

1. **Given** a confirmed mapping `Дмитрий Сергеевич` → `Песков`, **When** the user stages the storyboard, **Then** staging is given the confirmed source items and that canonical mapping, and the spoken dialogue still contains `Дмитрий Сергеевич` exactly where the source contains it.
2. **Given** a confirmed material state with one spoken item that has no canonical speaker, **When** the user requests a storyboard, **Then** staging is blocked, the explanation identifies that spoken material, and no ready storyboard is shown.
3. **Given** that blocked material state, **When** the user assigns a canonical speaker without editing the source text, **Then** that item's blocking finding is cleared, a new material state references the same Source Revision and Interpretation, the earlier mapping state remains distinguishable, no new Source Revision or Interpretation is created, and staging can proceed from the new material state.
4. **Given** a confirmed, fully resolved dialogue whose storyboard preserves source wording and order but uses imperfect artistic judgement, **When** staging completes, **Then** the storyboard is shown as ready.
5. **Given** a storyboard that drops, duplicates, reorders, or changes source dialogue, **When** the result is checked, **Then** each of those defects blocks readiness on its own and no ready storyboard is shown.

---

### User Story 4 - Keep the previous source recoverable (Priority: P2)

After the first commit, the user can edit the source text. The edit is saved as the working draft and is not promoted to a Source Revision until the user confirms a fresh reading. That confirmation creates a new Source Revision, a new Interpretation, and a first material state for the new text. The previous revision stays unchanged and can be viewed again with its exact text, Interpretation, current material state, and storyboard results tied to that revision.

If the working draft differs from the active committed text, choosing another Source Revision as active requires an explicit warning. The warning says the uncommitted draft will be replaced and is not a recoverable revision. Cancelling leaves the current revision and draft in place. Only confirming the warning replaces the draft with the selected revision's committed text.

A cast, alias, or speaker correction that does not change the source text creates a new immutable material state. That state references the same Source Revision and Interpretation. The earlier mapping state remains stored and distinguishable. The user-facing history in this feature is the Source Revision history. It does not include a browser of material states.

**Why this priority**: The user needs a durable history once the source has been committed, and an unsaved edit must not disappear while switching revisions. A cast correction must stay recoverable without pretending the dialogue changed.

**Independent Test**: Commit a draft, change one punctuation mark, confirm the new reading, and view the previous revision. Its original text is intact. With a different uncommitted edit present, choose an earlier revision, cancel the warning, and see the edit unchanged. Confirm the warning and see the selected revision's committed text loaded. Separately, change only an alias mapping: the source text stays the same, a new material state is distinguishable from the earlier one, and the earlier storyboard is not labeled ready for the new material state.

**Acceptance Scenarios**:

1. **Given** a committed Source Revision, **When** the user changes the source text, including punctuation or whitespace, requests a new reading, and confirms it, **Then** a new Source Revision, Interpretation, and first material state are stored, and the previous text remains available character for character.
2. **Given** two committed revisions, **When** the user views the earlier revision, **Then** its exact text, ordered Interpretation, current material state, and any storyboard produced from a material state of that revision are visible, and the active revision and working draft stay unchanged.
3. **Given** a working draft that differs from the active committed text, and an earlier revision whose current material state already has a ready storyboard, **When** the user chooses that earlier revision as active and cancels the warning, **Then** the warning has stated that the uncommitted draft will be replaced and is not a recoverable revision, the active revision and working draft remain unchanged, and no Source Revision is created.
4. **Given** the same unsaved draft and earlier revision, **When** the user confirms that warning, **Then** the working draft becomes the selected revision's committed text, that revision and its current material state become active, the storyboard staged from that material state is the current ready result, the other revision remains stored, and no new Source Revision is created.
5. **Given** a working draft that matches the active committed text character for character, **When** the user makes an earlier revision active, **Then** that revision becomes active without the destructive warning, and no new Source Revision is created.
6. **Given** a material state with a ready storyboard, **When** the user changes only an alias mapping or a speaker assignment, **Then** a new material state references the same Source Revision and Interpretation, the earlier material state remains distinguishable, no new Source Revision or Interpretation is created, and the existing storyboard remains visible as the previous result and is not labeled ready for the new material state.
7. **Given** that corrected material state, **When** the user stages it, **Then** the new storyboard result is tied to that corrected material state and can be labeled ready for it. The earlier storyboard remains the previous result.
8. **Given** a project whose active material state has a ready storyboard, **When** the user refreshes the page or restarts the application, **Then** the project resumes on that material state and that ready storyboard.

---

### Edge Cases

- An empty draft, or a draft with no source-authored material, can be saved. It cannot be confirmed or staged. The explanation is visible, and no Source Revision is created.
- A reading that fails or is interrupted leaves the draft saved, creates no Source Revision, and does not show a ready storyboard. The user can request the reading again.
- Refreshing before the first successful reading restores the draft and does not invent characters, aliases, or a storyboard.
- Before the first commit, a series of draft edits leaves no earlier committed revision to recover. Those edits stay saved and are not turned into a Source Revision by the act of keeping them. Cast corrections made before that confirmation are stored in the first material state. They do not create a material state before a Source Revision exists.
- An uncommitted working draft is restored after refresh and restart. Viewing another committed revision leaves that working draft in place.
- When the working draft differs from the active committed text, choosing another revision as active shows a warning before anything is replaced. The warning states that the uncommitted draft will be replaced and is not a recoverable revision. Cancelling leaves the active revision and working draft unchanged. Showing the warning and cancelling create no Source Revision. Only explicit confirmation replaces the working draft with the selected revision's committed text.
- When the working draft already matches the active committed text, choosing another revision as active does not show that warning.
- A speaker label, an address, and a mention may refer to the same canonical character. An address or mention remains inside the spoken source text. It does not become a speaker unless the user assigns that speaker.
- The user can map a surface form that occurs in the draft even when the reading did not propose that mapping. The draft wording stays unchanged.
- The user can merge two provisional characters into one canonical character, or point one surface form at a different canonical character, including a character named during review.
- Several source items may come from one physical line. Their relative order follows the draft.
- Each non-empty physical line that begins with an explicit `Speaker: message` label is a distinct source utterance. Adjacent lines by the same explicit speaker stay separate. A line that ends or begins with `...` is not merged with its neighbor because of that ellipsis. This does not remove the allowance that several different source items may share one physical line.
- Notes, directions, and silent actions stay source items. They do not become spoken lines unless the source presents them as dialogue.
- A mapping-only correction after a storyboard has been shown creates a new material state for the same source text. The earlier frames stay visible as the previous result and are not labeled ready for the new material state. The earlier mapping state remains stored and distinguishable. This feature does not show a browser of material states.
- An artistically imperfect but source-faithful storyboard remains ready. This feature does not ask for another staging attempt in order to improve directing.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The user MUST be able to paste one nearly finished Russian dialogue into one saved project. The draft MUST accept loosely structured text, including optional context, directions, silent actions, aliases, and informal notes. A `Character: line` form is not required.
- **FR-002**: The project and its working draft MUST survive page refresh and an application restart. The restored draft MUST match the saved draft character for character.
- **FR-003**: Before the first Source Revision is committed, draft edits MUST be saved and MUST NOT create a committed revision.
- **FR-004**: The user MUST be able to request a reading of the current draft. The reading MUST preserve the draft and MUST extract ordered source items, provisional characters, aliases and other surface forms, and speaker ownership for each spoken item. Speaker ownership MAY be explicit, provisionally inferred, or unresolved.
- **FR-005**: Source items MUST distinguish spoken utterances, actions, context, and notes. Several items MAY share one physical line. Each non-empty physical line with an explicit `Speaker: message` label is a distinct spoken utterance, including when the next line names the same speaker. Adjacent explicit messages MUST NOT be combined, and an ellipsis MUST NOT combine them. Item order MUST follow the draft. Exact draft wording and source order remain authoritative.
- **FR-006**: Material review MUST show the editable draft, the extracted characters, the proposed alias mappings, the speaker ownership, and the blocking findings for the current reading.
- **FR-007**: The only blocking finding in Material review is a spoken item with no confirmed canonical speaker. Each such finding MUST identify that spoken material by its source wording. The screen MUST NOT present non-blocking findings and MUST NOT ask follow-up content questions.
- **FR-008**: The user MUST be able to rename a canonical character, merge provisional characters, assign a spoken item to a canonical character, and map a surface form that occurs in the draft to a canonical character. The surface form `Дмитрий Сергеевич` MUST be mappable to `Песков`. None of these actions changes the draft wording.
- **FR-009**: The user MUST be able to confirm the current material only when its reading matches the current draft character for character. Confirmation MUST create one immutable Source Revision, the ordered Interpretation of that exact text, and the first immutable material state holding the canonical character and alias mappings accepted at that moment.
- **FR-010**: A later change to canonical names, alias mappings, or speaker assignments, with no change to the committed source text, MUST create a new immutable material state that references the same Source Revision and the same Interpretation. The previous material state MUST remain unchanged and distinguishable from the new one. The change MUST NOT create another Source Revision or Interpretation.
- **FR-011**: After the first commit, an edit to the source text, including punctuation or whitespace, MUST be saved as the working draft and MUST NOT by itself become a Source Revision. Confirming a new reading of that edited text MUST create a new Source Revision, Interpretation, and first material state for the new text. The previous revision MUST remain unchanged.
- **FR-012**: The user MUST be able to view a previous Source Revision, including its exact text, ordered Interpretation, current material state, and a storyboard result tied to a material state of that revision when one was produced. Viewing it MUST leave the active revision, active material state, and working draft unchanged. The user MUST also be able to make a previous revision active, and that choice MUST NOT destroy any stored revision. When the working draft differs from the active committed text, the choice MUST show an explicit warning that the uncommitted draft will be replaced and is not a recoverable revision. Cancelling MUST leave the active revision and working draft unchanged. Only explicit confirmation replaces the working draft with the selected revision's committed text and makes that revision, with its current material state, active. Showing the warning, cancelling, and confirming the switch MUST NOT create a Source Revision. When the working draft already matches the active committed text, making another revision active proceeds without that warning.
- **FR-013**: Storyboard staging MUST be available only for the active material state. Staging MUST receive that material state's Source Revision, ordered source items, and canonical character and alias mappings, including a confirmed mapping from `Дмитрий Сергеевич` to `Песков`. The storyboard result MUST be tied to that exact material state.
- **FR-014**: Displayed dialogue MUST continue to be reconstructed from source references. A canonical alias mapping MUST NOT replace or rewrite spoken source wording.
- **FR-015**: Unresolved speaker ownership MUST block staging. The visible explanation MUST identify each unresolved spoken item. No ready storyboard is shown. Assigning a canonical speaker without a source-text change MUST clear that item's block by creating a new material state for the same Source Revision and Interpretation. It MUST NOT create a Source Revision or Interpretation.
- **FR-016**: Existing source-fidelity validation MUST remain blocking. Missing, duplicated, reordered, or changed source dialogue, and any source-authored item that is not accounted for, MUST each block a ready storyboard.
- **FR-017**: A source-faithful storyboard MUST be presentable as ready when its artistic judgement is imperfect. This feature does not grade or improve staging artistry.
- **FR-018**: Refresh and application restart MUST restore the active material state. A storyboard staged from that exact material state MUST be restored with it and labeled ready. A storyboard staged from an earlier material state MUST remain available as the previous result and MUST NOT be labeled ready for the newer material state. Staging the newer material state MUST produce a result tied to that newer state.
- **FR-019**: A reading failure, an empty draft, or a draft with no source-authored material MUST remain visible as a failure to confirm or stage. The saved draft MUST remain, and no Source Revision or ready storyboard is created.

### Key Entities

- **Project**: The one saved local project. It holds the working draft, the Source Revision history, the material states that reference those revisions, and the storyboard result tied to each material state from which staging ran.
- **Working draft**: The editable source text. It is authoritative for exact wording and order. It is not a Source Revision. Before the first commit it has no revision history. After a commit it may differ from the active Source Revision until the user confirms a new reading.
- **Source Revision**: An immutable committed snapshot of the draft text, with a link to the revision it was confirmed from. Its text never changes after commit. It does not store the confirmed cast.
- **Interpretation**: The immutable ordered reading of one Source Revision: source items, provisional characters, proposed surface forms, and provisional speaker ownership. It refers to the source text. It is not a second copy of the dialogue, and a cast correction does not replace it.
- **Material state**: An immutable Project Document version for the confirmed cast. It references one Source Revision and that revision's Interpretation, and records the canonical characters, alias mappings, and speaker assignments accepted for that version. A cast, alias, or speaker correction with unchanged source text creates a new material state. The current material state of a revision is the one staging uses for that revision. Earlier material states remain stored and distinguishable. This feature does not offer a browser of material states.
- **Blocking speaker finding**: A spoken source item that does not yet have a confirmed canonical speaker in the current material state. It is the only finding Material review presents.
- **Storyboard result**: The existing read-only storyboard, or its blocking or failed outcome, tied to the exact material state from which it was staged.

### Out of Scope

- Frame editing, split or single changes, reorder, add, delete, frame-scoped regeneration, and undo.
- Image generation, a Visual storyboard, timing, and video.
- Accounts, collaboration, public deployment, and private links.
- A project list, project deletion, and an external retention policy.
- A general Project Document or material-state version browser. Source Revision history is the user-facing history in this feature.
- Non-blocking preflight findings, including option sets, contradictions that do not change speaker ownership, and marking a finding intentional.
- Repair loops and automatic improvement of dialogue wording.
- Artistic prompt optimization, and any change to the existing provider adapter, frame presentation, overflow handling, or artistic-evaluation baseline.
- Introducing or title sequences, character photographs, and likeness details.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For both a fresh paste and a later uncommitted edit, page refresh and an application restart each restore the working draft with every character unchanged.
- **SC-002**: After confirmation, page refresh and an application restart each restore the same committed text, the same source-item order, and the same canonical mappings.
- **SC-003**: In the `Дмитрий Сергеевич` / `Песков` example, the confirmed mapping is present in the material supplied to staging, and the spoken dialogue still matches the source slice character for character.
- **SC-004**: Each spoken item without a confirmed speaker blocks staging on its own, is identified on screen, and produces no ready storyboard. Assigning that speaker without a text change adds no Source Revision and no Interpretation. It adds one new material state, and the earlier mapping state remains distinguishable.
- **SC-005**: Confirming a punctuation-only or whitespace-only source edit creates one new Source Revision and one new Interpretation. The previous revision's text remains viewable character for character.
- **SC-006**: Before the first confirmation, draft edits create no recoverable Source Revision.
- **SC-007**: Each seeded loss, duplication, reordering, and wording change still blocks readiness individually.
- **SC-008**: A fully resolved, source-faithful dialogue can be confirmed and shown as a ready storyboard without a follow-up content question, including when the storyboard's artistic judgement is imperfect.
- **SC-009**: When every spoken item has a confirmed speaker, Material review shows no blocking finding. Across the acceptance scenarios, it shows no finding of any other kind.
- **SC-010**: When the working draft differs from the active committed text, choosing another revision shows a warning that the uncommitted draft will be replaced and is not a recoverable revision. Cancelling leaves the active revision and every character of the working draft unchanged. Confirming replaces the working draft with the selected revision's committed text. Showing the warning, cancelling, and confirming the replacement create no Source Revision.
- **SC-011**: A mapping-only correction creates no Source Revision and no Interpretation. It creates a new material state that remains distinguishable from the previous material state. The storyboard staged from the previous material state is not labeled ready for the new one. A storyboard staged from the corrected material state is tied to that new state.

## Assumptions

- This feature continues the accepted ready-dialogue path. The user already has a nearly finished Russian dialogue. The application does not invent a story from a blank prompt.
- The saved work is one local project. Opening the application resumes that project. A project list, sign-in, and private links belong to later work.
- The accepted local-first direction supplies the durability above: the project is stored outside the running application with PostgreSQL, and local startup may use Docker Compose. The scenarios do not ask the user to operate either one. Remote deployment remains outside this feature.
- A recommended `Character: line` form may appear in a draft. Explicit speaker labels are used when they are present. Otherwise the reading may infer a speaker. Unresolved ownership stays visible until the user assigns a canonical speaker.
- An alias or form of address identifies a person. It does not by itself decide who speaks. Speaker ownership is confirmed separately.
- The first confirmation has no parent revision. Each later text confirmation records the revision it started from and starts a new material state for the new text.
- Confirmed characters, aliases, and speaker assignments live in an immutable material state, the Project Document version required here. That state references a Source Revision and its Interpretation. Source Revision history remains the history the user reviews. Earlier material states stay stored so each storyboard remains tied to the mappings from which it was staged.
- Choosing another Source Revision as active loads its committed text only after the destructive confirmation when the working draft differs from the active committed text. Other revisions stay stored. The uncommitted draft is never promoted to a Source Revision by that switch.
- The storyboard staged from confirmed material keeps the current read-only storyboard behavior: exact dialogue comes from source references, source-fidelity failures block readiness, and the existing frame presentation and overflow handling stay in place.
- The existing server-side provider path performs the reading and the staging. This feature does not change that adapter, the staging prompt, or the artistic-evaluation baseline. No live provider request is required to accept this specification.
- The unfilled SpecKit constitution scaffold does not add product principles for this feature.
