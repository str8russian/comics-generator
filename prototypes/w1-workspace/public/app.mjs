import { mountFrame, panByPointer, panelContentSize, dialogueRegionVisible, renditionTransform } from "./frame-renderer.mjs";
import { findDisplayFrame, loadSnapshot } from "./model.mjs";
import { STAGES, deriveStages } from "./stages.mjs";
import { createStore } from "./store.mjs";

const MODE_LABELS = { spoken: "Spoken · Реплика", silent: "Silent · Молчание", hidden: "No line · Без реплики" };
const MODE_SHORT = { spoken: "Spoken", silent: "Silent", hidden: "No line" };
const PROVENANCE = {
  generated_from_source: "Generated from a source photo",
  uploaded_as_ready_anchor: "Uploaded as a ready anchor",
  refined_from_accepted_anchor: "Refined from the accepted anchor",
};
const BASIS_LEGEND = [
  ["explicit", "Explicit override", "The owner assigned this image (upload or reuse). Wins over everything else."],
  ["specialized", "Specialized image", "An image made for this panel's need (today: a panel generation)."],
  ["base", "Base state", "No specialized image: the approved base anchor stands in as the intentional speaking/listening state."],
  ["missing", "Nothing yet", "No image and no approved anchor for this character."],
];
const ERRORS = {
  "empty-dialogue": "This frame has no stored line. Writing new owner text is not wired in the prototype.",
  "speaker-required": "Choose which panel speaks.",
  "speaker-not-found": "That panel is no longer in the frame. Choose who speaks.",
  "not-dialogue-frame": "A text card has no dialogue.",
  "invalid-request": "Out of range: zoom stays within 1–3 and position within 0–100.",
  "nothing-to-undo": "Nothing to undo.",
  "frame-not-found": "This frame no longer exists.",
  "segment-required": "Choose a specific part of this structural frame.",
  "not-found": "This panel no longer exists.",
  "invalid-operation": "Unknown operation.",
};

const ui = {
  stage: "storyboard",
  editorOpen: false,
  frameContent: "auto",
  pendingSpeakerFor: null,
  scrollToSelection: false,
  plan: null,
};

let store = null;
let model = null;

const $ = (selector) => document.querySelector(selector);

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "on") for (const [event, handler] of Object.entries(value)) node.addEventListener(event, handler);
    else if (key === "style") Object.assign(node.style, value);
    else if (key in node && typeof value !== "string") node[key] = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function toast(message, kind = "info") {
  const node = $("#toast");
  node.textContent = message;
  node.dataset.kind = kind;
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.hidden = true; }, kind === "error" ? 6000 : 3500);
}

function inlineNote(anchor, message, kind = "stub") {
  const host = anchor.closest("[data-note-host]") || anchor.parentElement;
  host.querySelector(":scope > .inline-note")?.remove();
  const note = h("p", { class: `inline-note ${kind}`, role: "status" }, message);
  anchor.closest("[data-note-host]") ? host.append(note) : anchor.insertAdjacentElement("afterend", note);
}

// Every control routes through store.dispatch. Unwired production operations
// come back as "not-wired" and are explained next to the control.
function act(anchor, operation, { success } = {}) {
  const result = store.dispatch(operation);
  if (result.kind === "not-wired") {
    inlineNote(anchor, `Not wired in prototype · ${result.message} (operation: ${operation.op})`);
  } else if (!result.ok) {
    inlineNote(anchor, ERRORS[result.kind] || `Rejected: ${result.kind}`, "error");
  } else if (result.changed === false) {
    toast("No change.");
  } else if (success) {
    toast(success(result));
  }
  return result;
}

function stubButton(label, op, { cls = "", disabled = false, title = null } = {}) {
  return h("button", {
    type: "button",
    class: `stub ${cls}`.trim(),
    disabled,
    title,
    on: { click: (event) => act(event.currentTarget, { op }) },
  }, label, h("span", { class: "stub-mark", "aria-hidden": "true" }, "◌"));
}

// ---- selection helpers ------------------------------------------------------

function currentFrames() {
  return store.frames();
}

function selectedFrame(frames = currentFrames()) {
  return findDisplayFrame(frames, store.selection.frame);
}

function selectedPanel(frame) {
  const id = store.selection.panelId;
  return frame?.panels.find((panel) => panel.id === id) ?? null;
}

function address(frame) {
  return { structureFrameId: frame.structureFrameId, structureSegmentIndex: frame.structureSegmentIndex };
}

function selectFrame(frame, { panelId = null, scroll = false } = {}) {
  ui.pendingSpeakerFor = null;
  ui.scrollToSelection = scroll;
  store.select(frame ? address(frame) : null, panelId);
}

function scopeLabel(frames = currentFrames()) {
  const frame = selectedFrame(frames);
  if (!frame) return { chip: "Project", hint: "Ask the assistant to plan a change across the project…" };
  const panel = selectedPanel(frame);
  if (panel && ui.editorOpen) return { chip: `Panel ${panel.address}`, hint: `Ask the assistant about panel ${panel.address}…` };
  return { chip: `Frame ${frame.number}`, hint: `Ask the assistant about frame ${frame.number}…` };
}

// ---- top bar ----------------------------------------------------------------

function renderTopbar(frames, stages) {
  $("#project-title").textContent = model.project.title;
  const source = model.source.method === "read-only-sql"
    ? `Real project snapshot · read-only export${model.source.exportedAt ? ` · ${model.source.exportedAt.slice(0, 16).replace("T", " ")} UTC` : ""}`
    : (model.source.method === "synthetic-fixture" ? "Synthetic fixture (no real project data)" : `Data source: ${model.source.method}`);
  $("#data-source").textContent = source;
  const nav = $("#stage-nav");
  nav.replaceChildren(...STAGES.flatMap((stage, index) => {
    const info = stages[stage.id];
    const button = h("button", {
      type: "button",
      class: `stage-tab tone-${info.tone}`,
      "aria-current": ui.stage === stage.id && !ui.editorOpen ? "step" : null,
      "data-stage": stage.id,
      on: { click: () => goto(stage.id) },
    }, h("span", { class: "stage-name" }, stage.label), h("span", { class: "stage-chip" }, info.chip));
    return index ? [h("span", { class: "stage-arrow", "aria-hidden": "true" }, "→"), button] : [button];
  }));
  const undo = $("#undo");
  undo.disabled = !store.canUndo;
  undo.textContent = store.canUndo ? `Undo: ${store.undoLabel}` : "Nothing to undo";
  $("#reset").disabled = !store.dirty;
  const scope = scopeLabel(frames);
  $("#assistant-scope").textContent = scope.chip;
  $("#assistant-input").placeholder = scope.hint;
}

function goto(stageId) {
  ui.stage = stageId;
  ui.editorOpen = false;
  ui.plan = null;
  if (stageId !== "storyboard" && stageId !== "visual") store.select(null);
  else render();
}

// ---- shared pieces ----------------------------------------------------------

function stageHeader(info, title, extra = null) {
  const next = info.next;
  const nextButton = next ? h("button", {
    type: "button",
    class: `primary next-action${next.stub ? " stub" : ""}`,
    on: {
      click: (event) => {
        if (next.goto) goto(next.goto);
        else act(event.currentTarget, { op: next.stub });
      },
    },
  }, next.label, next.stub ? h("span", { class: "stub-mark", "aria-hidden": "true" }, "◌") : null) : null;
  return h("header", { class: "stage-header", "data-note-host": "" },
    h("div", {}, h("h2", {}, title), h("p", { class: "stage-status" }, info.status)),
    h("div", { class: "stage-next" }, h("span", { class: "next-label" }, "Next"), nextButton, extra),
  );
}

function modeChip(frame) {
  if (frame.frameKind === "text") return h("span", { class: "chip mode-text" }, "Text card");
  const label = MODE_SHORT[frame.dialogueMode] || "Mode missing";
  const who = frame.dialogueMode === "spoken" && frame.speaker ? ` · ${frame.speaker.subject || `panel ${frame.speaker.panelIndex + 1}`}` : "";
  return h("span", { class: `chip mode-${frame.dialogueMode || "missing"}` }, `${label}${who}`);
}

function durationText(frame) {
  const timing = frame.timing;
  if (timing.durationSeconds == null) return `${timing.durationFrames} frames (invalid)`;
  return `${(Math.round(timing.durationSeconds * 10) / 10).toFixed(1)} s`;
}

function frameMode(frame, stage) {
  if (stage === "visual") return "visual";
  if (ui.frameContent === "structure") return "structure";
  const pictured = frame.panels.some((panel) => panel.asset);
  return pictured ? "visual" : "structure";
}

function basisBadge(panel) {
  return h("span", { class: `basis basis-${panel.basis.kind}`, title: panel.basis.label },
    `${panel.address} ${panel.subject || "?"}`, h("em", {}, ` · ${panel.basis.kind === "base" ? `base · ${panel.role}` : panel.basis.label.split(" · ")[0].toLowerCase()}`));
}

// ---- storyboard / visual grid -----------------------------------------------

function frameCard(frame, stage, selected) {
  const thumb = h("div", { class: "thumb" });
  mountFrame(thumb, frame, 0.15, frameMode(frame, stage));
  const segment = Number.isInteger(frame.structureSegmentIndex)
    ? h("span", { class: "chip beat", title: "Display part of one structural frame" }, `beat part ${frame.structureSegmentIndex + 1}`)
    : null;
  let line;
  if (frame.frameKind === "text") line = h("p", { class: "line" }, frame.textCard || "Empty text card");
  else if (frame.dialogueMode === "spoken") line = h("p", { class: "line" }, `«${frame.visibleDialogue}»`);
  else if (frame.dialogueMode === "silent") line = h("p", { class: "line muted" }, "Silent: empty dialogue bar keeps the frame height");
  else line = h("p", { class: "line muted" }, "No line: pictures use the full height");
  const below = stage === "visual"
    ? h("div", { class: "basis-row" }, frame.panels.map(basisBadge))
    : null;
  return h("article", {
    class: `frame-card${selected ? " selected" : ""}`,
    "data-frame": frame.id,
    tabindex: "0",
    "aria-label": `Frame ${frame.number}`,
    "aria-selected": selected ? "true" : "false",
    on: {
      click: () => selectFrame(frame),
      dblclick: () => openEditor(frame),
      keydown: (event) => {
        if (event.key === "Enter") openEditor(frame);
        if (event.key === " ") { event.preventDefault(); selectFrame(frame); }
      },
    },
  },
  h("header", { class: "card-head" },
    h("span", { class: "frame-no" }, String(frame.number)),
    h("span", { class: "chip layout" }, frame.frameKind === "text" ? "text" : (frame.layout || `${frame.panels.length} panel`)),
    stage === "visual"
      ? h("span", { class: `chip ${frame.visualReady ? "ready" : "not-ready"}` }, frame.visualReady ? "images ready" : "needs images")
      : modeChip(frame),
    segment),
  thumb,
  below,
  stage === "visual" ? null : line,
  h("footer", { class: "card-foot" },
    h("span", { class: "duration" }, durationText(frame)),
    h("button", {
      type: "button",
      class: "open",
      on: { click: (event) => { event.stopPropagation(); openEditor(frame); } },
    }, "Open")));
}

function frameGrid(frames, stage) {
  const selected = selectedFrame(frames);
  return h("div", { class: "frame-grid", "aria-label": "Frames" },
    frames.map((frame) => frameCard(frame, stage, selected && selected.id === frame.id)));
}

function storyboardView(frames, stages) {
  const toggle = h("div", { class: "segmented", role: "group", "aria-label": "Frame content" },
    [["auto", "Images where available"], ["structure", "Descriptions (Structure)"]].map(([value, label]) => h("button", {
      type: "button",
      "aria-pressed": ui.frameContent === value ? "true" : "false",
      on: { click: () => { ui.frameContent = value; render(); } },
    }, label)));
  return h("div", { class: "stage storyboard" },
    stageHeader(stages.storyboard, "Storyboard"),
    h("div", { class: "grid-tools" },
      h("span", { class: "tool-label" }, "Frame content"), toggle,
      h("span", { class: "hint" }, "Structure and Visual share one frame skeleton: same geometry, text descriptions or images inside it.")),
    frames.length ? frameGrid(frames, "storyboard") : h("p", { class: "empty" }, "The snapshot has no frames."));
}

function visualView(frames, stages) {
  const complete = frames.length > 0 && frames.every((frame) => frame.visualReady);
  const approved = store.visualApproved;
  const gate = h("section", { class: `gate ${approved ? "passed" : "pending"}`, "data-note-host": "" },
    h("div", {},
      h("p", { class: "eyebrow" }, "Required gate before Video"),
      h("h3", {}, approved ? "Visual storyboard approved" : "Visual storyboard not approved"),
      h("p", { class: "helper" }, approved
        ? "This exact version is approved. Any frame change creates a new version that needs approval again."
        : (complete ? "Review every frame, then approve this version." : "Every panel needs an image before approval."))),
    approved ? null : stubButton("Approve Visual storyboard", "approveVisual", { cls: "primary", disabled: !complete, title: complete ? null : "Every panel needs an image first" }));
  const hasBase = frames.some((frame) => frame.panels.some((panel) => panel.basis.kind === "base"));
  const legend = h("section", { class: "legend" },
    h("h3", {}, "What each panel shows, in priority order"),
    h("ol", {}, BASIS_LEGEND.map(([kind, title, copy]) => h("li", {},
      h("span", { class: `basis basis-${kind}` }, title), " ", copy))),
    hasBase ? null : illustrativeBase());
  return h("div", { class: "stage visual" },
    stageHeader(stages.visual, "Visual storyboard"),
    gate,
    legend,
    frames.length ? frameGrid(frames, "visual") : h("p", { class: "empty" }, "The snapshot has no frames."));
}

function illustrativeBase() {
  const character = model.characters.find((entry) => entry.anchorAssetId && model.assets[entry.anchorAssetId]);
  const url = character ? model.assets[character.anchorAssetId].url : null;
  return h("figure", { class: "illustration" },
    h("span", { class: "illustration-tag" }, "Illustrative only · not from this project's frames"),
    url ? h("img", { src: url, alt: `${character.name} base anchor` }) : h("div", { class: "illustration-empty" }),
    h("figcaption", {},
      h("span", { class: "basis basis-base" }, `Base state · listening${character ? ` · ${character.name}` : ""}`),
      " Every panel in this snapshot already has an image. A panel without a specialized image would show the approved base anchor like this, labelled as an intentional base state rather than a failed or missing generation. Mapping logic is R1 and is not implemented here."));
}

function storyView(stages) {
  const story = model.story;
  return h("div", { class: "stage story" },
    stageHeader(stages.story, "Story"),
    h("div", { class: "two-col" },
      h("section", { class: "card" },
        h("h3", {}, "Source revision (read-only)"),
        story.sourceText ? h("pre", { class: "source" }, story.sourceText) : h("p", { class: "empty" }, "No source text in the snapshot.")),
      h("section", { class: "card" },
        h("h3", {}, "Confirmed cast"),
        story.cast.length
          ? h("ul", { class: "plain" }, story.cast.map((name) => {
            const aliases = story.aliases.filter((alias) => alias.characterName === name && alias.surface !== name).map((alias) => alias.surface);
            return h("li", {}, h("strong", {}, name), aliases.length ? ` · also “${aliases.join("”, “")}”` : "");
          }))
          : h("p", { class: "empty" }, "No cast in the snapshot."),
        h("details", { class: "more" },
          h("summary", {}, "More story actions"),
          h("div", { class: "action-list", "data-note-host": "" },
            stubButton("Edit draft and read again (text provider)", "reading"),
            stubButton("Edit characters, aliases, speakers", "cast_edit"),
            stubButton("Confirm material", "confirm_material"),
            stubButton("Stage storyboard again (text provider)", "stage_storyboard"),
            stubButton("Apply a structure edit to all frames (text provider)", "structure_edit"))))));
}

function charactersView(stages) {
  return h("div", { class: "stage characters" },
    stageHeader(stages.characters, "Characters"),
    h("p", { class: "helper" }, "Read-only. Identity photos are not exported to the snapshot; base images are."),
    h("div", { class: "character-grid" }, model.characters.map((character) => {
      const approved = character.anchorStatus === "approved";
      const url = character.anchorAssetId ? model.assets[character.anchorAssetId]?.url : null;
      return h("article", { class: "character-card", "data-note-host": "" },
        h("header", {}, h("h3", {}, character.name),
          h("span", { class: `chip ${approved ? "ready" : "not-ready"}` }, approved ? "Base image approved" : "Needs base image")),
        url ? h("img", { src: url, alt: `${character.name} base image` }) : h("div", { class: "no-image" }, approved ? "Image missing from snapshot" : "No accepted image yet"),
        approved ? h("p", { class: "helper" }, PROVENANCE[character.anchorProvenance] || "Origin not recorded") : null,
        h("div", { class: "card-actions" }, approved
          ? [stubButton("Refine image", "anchor_generate"), stubButton("Create replacement", "anchor_generate"), stubButton("Delete", "anchor_retire", { cls: "danger" })]
          : [stubButton("Create image", "anchor_generate", { cls: "primary" })]));
    })));
}

function videoView(frames, stages) {
  const approved = store.visualApproved;
  return h("div", { class: "stage video" },
    stageHeader(stages.video, "Video"),
    h("section", { class: `gate ${approved ? "passed" : "locked"}` },
      h("div", {},
        h("p", { class: "eyebrow" }, "Gate"),
        h("h3", {}, approved ? "Visual approval in place" : "Locked: Visual approval is required"),
        h("p", { class: "helper" }, approved
          ? "Timing and the Video Spec compile from this approved version."
          : "Video compiles only from an approved Visual storyboard. Approve it in the Visual stage."))),
    h("section", { class: "card render-card", "data-note-host": "" },
      h("h3", {}, "Render"),
      h("dl", { class: "facts" },
        h("dt", {}, "Frames"), h("dd", {}, String(frames.length)),
        h("dt", {}, "Nominal length"), h("dd", {}, `${(frames.reduce((sum, frame) => sum + (frame.timing.durationFrames || 0), 0) / 30).toFixed(1)} s at 30 fps`),
        h("dt", {}, "Last render"), h("dd", {}, "Not captured: render state lives in the production server's memory")),
      h("div", { class: "render-options" },
        h("label", {}, "Transitions ", h("select", { disabled: true }, h("option", {}, "Hard cut (default)"), h("option", {}, "Cross dissolve"))),
        h("label", {}, "Intro ", h("select", { disabled: true }, h("option", {}, "No intro")))),
      stubButton("Render video (not wired)", "render", { cls: "primary", disabled: !approved, title: approved ? null : "Approve the Visual storyboard first" }),
      h("p", { class: "helper" }, "Non-functional entry point. No render runs from the prototype.")));
}

// ---- inspector (contextual frame vocabulary) --------------------------------

function dialogueControls(frame) {
  if (frame.frameKind === "text") {
    return h("section", { class: "group" }, h("h4", {}, "Dialogue"), h("p", { class: "helper" }, "A text card has no dialogue or speaker."));
  }
  const pending = ui.pendingSpeakerFor === frame.id;
  const modeButtons = h("div", { class: "segmented modes", role: "group", "aria-label": "Dialogue mode" },
    ["spoken", "silent", "hidden"].map((mode) => h("button", {
      type: "button",
      "aria-pressed": frame.dialogueMode === mode ? "true" : "false",
      "data-mode": mode,
      on: {
        click: (event) => {
          if (frame.dialogueMode === mode) return;
          const result = act(event.currentTarget, { op: "setFrameDialogue", ...address(frame), dialogueMode: mode }, {
            success: () => `Frame ${frame.number}: ${MODE_LABELS[mode]}`,
          });
          if (!result.ok && result.kind === "speaker-required") {
            ui.pendingSpeakerFor = frame.id;
            render();
          }
        },
      },
    }, MODE_LABELS[mode])));
  let speaker;
  const panels = frame.panels;
  if (frame.dialogueMode === "spoken" || pending) {
    if (panels.length === 1) {
      speaker = h("p", { class: "helper" }, `Speaker: ${panels[0].subject || "panel 1"} (the only panel)`);
    } else {
      speaker = h("fieldset", { class: "speaker" },
        h("legend", {}, pending ? "Who speaks? (choose to switch to Spoken)" : "Speaker"),
        panels.map((panel) => h("label", {},
          h("input", {
            type: "radio",
            name: `speaker-${frame.id}`,
            checked: frame.dialogueMode === "spoken" && frame.speakerPanel === panel.panelIndex,
            on: {
              change: (event) => act(event.currentTarget.closest("fieldset"), {
                op: "setFrameDialogue",
                ...address(frame),
                dialogueMode: "spoken",
                speakerPanelId: panel.id,
              }, { success: () => `Frame ${frame.number}: ${panel.subject || `panel ${panel.panelIndex + 1}`} speaks` }),
            },
          }),
          ` ${panel.address} · ${panel.subject || `panel ${panel.panelIndex + 1}`}`)));
    }
  }
  const line = frame.storedDialogue.trim()
    ? h("blockquote", { class: `stored-line${frame.dialogueMode === "spoken" ? "" : " dormant"}` },
      frame.storedDialogue,
      frame.dialogueMode === "spoken" ? null : h("span", { class: "dormant-tag" }, " (kept dormant; not shown or timed)"))
    : h("p", { class: "helper" }, "No stored line.");
  return h("section", { class: "group", "data-note-host": "" },
    h("h4", {}, "Dialogue"),
    modeButtons,
    speaker,
    line,
    h("p", { class: "helper" }, "Source-exact text. Frame-local changes never edit the draft. No AI rewriting."));
}

function structureControls(frame) {
  const beatNote = Number.isInteger(frame.structureSegmentIndex)
    ? h("p", { class: "helper" }, "This card is part of a structural frame. Duplicate, insert, move, and delete apply to the whole structural frame.")
    : null;
  return h("section", { class: "group", "data-note-host": "" },
    h("h4", {}, "Frame"),
    h("div", { class: "action-list" },
      stubButton("Insert image frame after", "insertFrame"),
      stubButton("Insert text card after", "insertFrame"),
      stubButton("Move earlier", "reorderFrames"),
      stubButton("Move later", "reorderFrames"),
      stubButton("Delete frame", "deleteFrame", { cls: "danger" })),
    beatNote);
}

function moreFrameControls(frame) {
  const panels = frame.panels;
  const layout = frame.frameKind === "text" ? [] : (panels.length === 1
    ? [stubButton("Add panel (single → split2)", "addPanel")]
    : [stubButton("Swap panels", "reorderPanels"), ...panels.map((panel) => stubButton(`Remove panel ${panel.address}`, "deletePanel"))]);
  return h("details", { class: "more" },
    h("summary", {}, "More frame actions"),
    h("div", { class: "action-list", "data-note-host": "" },
      layout,
      frame.frameKind === "text" ? stubButton("Edit card text", "setTextCard") : null,
      frame.frameKind === "text" ? null : stubButton("Create missing images for this frame (image provider)", "frame_generate"),
      frame.frameKind === "text" ? null : stubButton("Assign an existing or uploaded image to a panel", "assignAsset"),
      frame.panels.some((panel) => !panel.subject) ? stubButton("Choose a panel character", "setManualSubject") : null,
      frame.sourceItemId && frame.frameKind !== "text" ? stubButton("Edit the whole source line (changes the draft)", "source_utterance_edit") : null));
}

function timingControls(frame) {
  const source = { explicit: "set by owner", default: "default from dialogue length", invalid: "invalid" }[frame.timing.source] || frame.timing.source;
  return h("section", { class: "group", "data-note-host": "" },
    h("h4", {}, "Timing"),
    h("p", {}, `${durationText(frame)} · ${frame.timing.durationFrames} frames at 30 fps (${source})`),
    stubButton("Change duration", "setDuration"));
}

function duplicateButton(frame, cls = "") {
  return h("button", {
    type: "button",
    class: `duplicate ${cls}`.trim(),
    on: {
      click: (event) => act(event.currentTarget, { op: "duplicateFrame", ...address(frame) }, {
        success: (result) => {
          ui.scrollToSelection = true;
          return `Duplicated frame ${frame.number} → new frame ${result.operationResult.createdDisplayNumber} (selected). One Undo removes it.`;
        },
      }),
    },
  }, "Duplicate frame");
}

function renderInspector(frames) {
  const inspector = $("#inspector");
  const frame = selectedFrame(frames);
  const show = !ui.editorOpen && (ui.stage === "storyboard" || ui.stage === "visual") && frame;
  inspector.hidden = !show;
  if (!show) {
    inspector.replaceChildren();
    return;
  }
  inspector.replaceChildren(
    h("header", { class: "inspector-head" },
      h("div", {},
        h("p", { class: "eyebrow" }, "Selected"),
        h("h3", {}, `Frame ${frame.number}`),
        h("p", { class: "helper" }, [frame.frameKind === "text" ? "text card" : (frame.layout || ""), frame.frameKind === "image" ? "image frame" : null].filter(Boolean).join(" · "))),
      h("button", { type: "button", class: "quiet close", "aria-label": "Clear selection", on: { click: () => selectFrame(null) } }, "×")),
    h("div", { class: "primary-actions", "data-note-host": "" },
      h("button", { type: "button", class: "primary", on: { click: () => openEditor(frame) } }, "Open Frame Editor"),
      duplicateButton(frame)),
    dialogueControls(frame),
    timingControls(frame),
    structureControls(frame),
    moreFrameControls(frame));
}

// ---- Frame Editor + Panel Editor shell ---------------------------------------

function openEditor(frame) {
  ui.editorOpen = true;
  ui.plan = null;
  if (ui.stage !== "visual") ui.stage = "storyboard";
  selectFrame(frame);
}

function closeEditor() {
  ui.editorOpen = false;
  ui.scrollToSelection = true;
  const frame = selectedFrame();
  store.select(frame ? address(frame) : null, null);
}

function editorView(frames) {
  const frame = selectedFrame(frames);
  if (!frame) {
    ui.editorOpen = false;
    return null;
  }
  const index = frames.indexOf(frame);
  const prev = frames[index - 1];
  const next = frames[index + 1];
  const panel = selectedPanel(frame);
  const canvasHost = h("div", { class: "editor-canvas" });
  const scale = 0.4;
  const stage = mountFrame(canvasHost, frame, scale, frameMode(frame, ui.stage));
  bindPanelPointer(stage, frame, scale);
  const chips = h("div", { class: "panel-chips", role: "group", "aria-label": "Panels" },
    frame.panels.map((entry) => h("button", {
      type: "button",
      class: `panel-chip${panel?.id === entry.id ? " selected" : ""}`,
      "aria-pressed": panel?.id === entry.id ? "true" : "false",
      on: { click: () => store.select(address(frame), entry.id) },
    },
    h("strong", {}, `Panel ${entry.address}`),
    ` ${entry.subject || "no character"} · ${entry.role}`,
    h("span", { class: `basis basis-${entry.basis.kind}` }, entry.basis.kind === "base" ? "base state" : entry.basis.kind))));
  return h("div", { class: "editor" },
    h("header", { class: "editor-head" },
      h("button", { type: "button", class: "quiet", on: { click: closeEditor } }, `← Back to ${ui.stage === "visual" ? "Visual" : "Storyboard"}`),
      h("h2", {}, `Frame Editor · Frame ${frame.number}`, h("span", { class: "of" }, ` of ${frames.length}`)),
      h("div", { class: "editor-nav" },
        h("button", { type: "button", disabled: !prev, on: { click: () => selectFrame(prev) } }, "‹ Previous"),
        h("button", { type: "button", disabled: !next, on: { click: () => selectFrame(next) } }, "Next ›")),
      h("div", { class: "editor-actions", "data-note-host": "" }, duplicateButton(frame, "primary"))),
    h("div", { class: "editor-grid" },
      h("div", { class: "editor-main" },
        canvasHost,
        frame.panels.length ? h("p", { class: "helper" }, "Select a panel below or click it in the frame. Drag a picture to pan it.") : null,
        chips,
        h("div", { class: "editor-sections" },
          dialogueControls(frame),
          timingControls(frame),
          structureControls(frame),
          moreFrameControls(frame))),
      h("aside", { class: "panel-editor", "aria-label": "Panel Editor" },
        panel ? panelEditor(frame, panel) : h("div", { class: "panel-empty" },
          h("h3", {}, "Panel Editor"),
          h("p", { class: "helper" }, frame.panels.length
            ? "Select a panel to see its image, basis, framing (zoom, pan, mirror), revision, and references."
            : "This frame has no panels.")))));
}

function placementPatch(frame, panel, patch, message) {
  return store.dispatch({ op: "placement", frameId: frame.id, panelIndex: panel.panelIndex, ...patch }).changed
    ? toast(message) : null;
}

function panelEditor(frame, panel) {
  const hasImage = Boolean(panel.asset);
  const preview = hasImage
    ? h("img", { class: "panel-preview", src: panel.asset, alt: `${panel.subject || "Panel"} current image` })
    : h("div", { class: "panel-preview none" }, "No image");
  const basisCopy = {
    explicit: "Current basis: an image the owner assigned to this panel.",
    specialized: "Current basis: the image generated for this panel.",
    base: "Current basis: the approved base anchor, standing in as the intentional base state.",
    missing: "Current basis: none yet.",
  }[panel.basis.kind];
  const zoomValue = h("output", { class: "value" }, `${panel.zoom.toFixed(2)}×`);
  const zoom = h("input", {
    type: "range",
    min: "1",
    max: "3",
    step: "0.05",
    value: String(panel.zoom),
    disabled: !hasImage,
    "aria-label": "Zoom",
    on: {
      input: (event) => {
        const value = Number(event.target.value);
        zoomValue.textContent = `${value.toFixed(2)}×`;
        const image = document.querySelector(`.editor-canvas .panel[data-panel-index="${panel.panelIndex}"] .panel-asset`);
        if (image) image.style.transform = renditionTransform({ zoom: value, mirrored: panel.mirrored });
      },
      change: (event) => placementPatch(frame, panel, { zoom: Number(event.target.value) }, `Zoom saved for panel ${panel.address} without regeneration.`),
    },
  });
  // Same direction convention as panByPointer: moving the picture left raises
  // positionX unless the panel is mirrored.
  const nudge = (label, arrow, dx, dy) => h("button", {
    type: "button",
    class: "nudge",
    disabled: !hasImage,
    "aria-label": label,
    title: label,
    on: {
      click: () => placementPatch(frame, panel, {
        positionX: Math.min(100, Math.max(0, panel.positionX + (panel.mirrored ? -dx : dx))),
        positionY: Math.min(100, Math.max(0, panel.positionY + dy)),
      }, `Pan saved for panel ${panel.address}.`),
    },
  }, arrow);
  const lineage = panel.assetSubmittedText ? h("p", { class: "helper" }, `Last revision request: “${panel.assetSubmittedText}”`) : null;
  return h("div", { class: "panel-shell" },
    h("header", {},
      h("p", { class: "eyebrow" }, "Panel Editor"),
      h("h3", {}, `Panel ${panel.address} · ${panel.subject || "no character"}`),
      h("p", { class: "helper" }, `Role in this frame: ${panel.role}`)),
    h("section", { class: "group" },
      h("h4", {}, "Current image"),
      preview,
      h("p", {}, h("span", { class: `basis basis-${panel.basis.kind}` }, panel.basis.label)),
      h("p", { class: "helper basis-copy" }, basisCopy),
      lineage,
      panel.assetMissing ? h("p", { class: "inline-note error" }, "The assigned image file is missing from the snapshot.") : null),
    h("section", { class: "group placement" },
      h("h4", {}, "Framing · no regeneration"),
      h("label", { class: "row" }, h("span", { class: "row-label" }, "Zoom"), zoom, zoomValue),
      h("div", { class: "row" },
        h("span", { class: "row-label" }, "Pan"),
        h("div", { class: "nudges" },
          nudge("Move picture left", "←", 5, 0),
          nudge("Move picture right", "→", -5, 0),
          nudge("Move picture up", "↑", 0, 5),
          nudge("Move picture down", "↓", 0, -5)),
        h("span", { class: "value" }, `X ${panel.positionX} · Y ${panel.positionY}`)),
      h("p", { class: "helper" }, "Or drag the picture inside the frame."),
      h("div", { class: "row" },
        h("span", { class: "row-label" }, "Mirror"),
        h("button", {
          type: "button",
          "aria-pressed": panel.mirrored ? "true" : "false",
          disabled: !hasImage,
          on: { click: () => placementPatch(frame, panel, { mirrored: !panel.mirrored }, `Mirror ${panel.mirrored ? "off" : "on"} for panel ${panel.address}.`) },
        }, panel.mirrored ? "Mirrored horizontally" : "Mirror horizontally")),
      h("button", {
        type: "button",
        class: "quiet",
        disabled: !hasImage,
        on: { click: () => placementPatch(frame, panel, { reset: true }, `Framing reset for panel ${panel.address}.`) },
      }, "Reset framing (zoom 1, 50/30, no mirror)"),
      hasImage ? null : h("p", { class: "helper" }, "Framing applies once the panel has its own image.")),
    h("section", { class: "group future", "data-note-host": "" },
      h("h4", {}, "Image revision ", h("span", { class: "future-tag" }, "future · R2")),
      h("p", { class: "current-basis" }, h("span", { class: "basis-dot" }), `Current basis: ${panel.basis.label}`),
      h("div", { class: "action-list two" },
        stubButton("Refine current", "future:refineCurrent"),
        stubButton("New variation", "future:newVariation")),
      h("p", { class: "helper" }, "Refine starts from the current basis. A new variation starts fresh. Today's panel regeneration (image provider) maps to Refine current.")),
    h("section", { class: "group refs", "data-note-host": "" },
      h("h4", {}, "References"),
      h("div", { class: "ref identity" },
        panel.anchorAsset ? h("img", { src: panel.anchorAsset, alt: "Identity anchor" }) : h("div", { class: "ref-empty" }),
        h("div", {},
          h("p", { class: "ref-title" }, "Identity reference"),
          h("p", { class: "helper" }, panel.anchorAsset
            ? `Approved base anchor for ${panel.subject}. Decides who the character is in every state.`
            : "No approved base anchor for this character."))),
      h("div", { class: "ref performance" },
        panel.performanceAsset ? h("img", { src: panel.performanceAsset, alt: "Performance reference" }) : h("div", { class: "ref-empty" }, "none"),
        h("div", {},
          h("p", { class: "ref-title" }, "Performance reference ", h("span", { class: "future-tag" }, "future · R3")),
          h("p", { class: "helper" }, "Pose, expression, gaze, and crop for this panel's state only. Never identity, never other states."),
          stubButton(panel.performanceAsset ? "Replace performance reference" : "Attach performance reference", "future:attachPerformanceReference")))),
    h("section", { class: "group" },
      h("h4", {}, "Panel intent"),
      h("p", { class: "intent" }, panel.description || "No description."),
      h("p", { class: "helper" }, "Supported one-character intent on a plain matte. Review text, not a prompt.")),
    h("details", { class: "more" },
      h("summary", {}, "More panel actions"),
      h("div", { class: "action-list", "data-note-host": "" },
        stubButton("Assign an image from this storyboard", "assignAsset"),
        stubButton("Upload an image", "uploadAsset"),
        stubButton("Regenerate this panel with an instruction (image provider)", "panel-generation"),
        stubButton("Choose character", "setManualSubject"))));
}

function bindPanelPointer(stage, frame, scale) {
  for (const column of stage.querySelectorAll(".panel")) {
    const panel = frame.panels[Number(column.dataset.panelIndex)];
    if (!panel) continue;
    const image = column.querySelector(".panel-asset");
    if (store.selection.panelId === panel.id) column.classList.add("panel-selected");
    if (image && panel.hasState && panel.assetId) column.classList.add("panel-pannable");
    let drag = null;
    column.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, positionX: panel.positionX, positionY: panel.positionY };
      column.setPointerCapture(event.pointerId);
    });
    column.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.id || !image || !panel.assetId) return;
      const size = panelContentSize(frame.panels.length, dialogueRegionVisible(frame));
      const next = panByPointer({
        positionX: drag.positionX,
        positionY: drag.positionY,
        deltaX: event.clientX - drag.x,
        deltaY: event.clientY - drag.y,
        frameScale: scale,
        panelWidth: size.width,
        panelHeight: size.height,
        mirrored: panel.mirrored,
      });
      if (!next) return;
      drag.moved = Math.abs(event.clientX - drag.x) + Math.abs(event.clientY - drag.y) > 2;
      drag.next = next;
      const position = `${next.positionX}% ${next.positionY}%`;
      image.style.objectPosition = position;
      image.style.transformOrigin = position;
    });
    const finish = (event, cancelled) => {
      if (!drag || event.pointerId !== drag.id) return;
      const { moved, next } = drag;
      drag = null;
      if (cancelled) { render(); return; }
      if (moved && next) {
        store.dispatch({ op: "placement", frameId: frame.id, panelIndex: panel.panelIndex, ...next });
        toast(`Pan saved for panel ${panel.address}.`);
      }
      if (store.selection.panelId !== panel.id) store.select(address(frame), panel.id);
    };
    column.addEventListener("pointerup", (event) => finish(event, false));
    column.addEventListener("pointercancel", (event) => finish(event, true));
  }
}

// ---- assistant (mock) ---------------------------------------------------------

function renderPlan(frames) {
  const host = $("#plan-preview");
  if (!ui.plan) {
    host.hidden = true;
    host.replaceChildren();
    return;
  }
  const frame = selectedFrame(frames);
  const n = frame?.number ?? 1;
  const scope = scopeLabel(frames).chip;
  host.hidden = false;
  host.replaceChildren(
    h("header", {},
      h("h3", {}, "Plan preview"),
      h("span", { class: "mock-tag" }, "Static example layout · not generated from your text")),
    h("p", { class: "helper" }, "Your request (not sent anywhere): ", h("q", {}, ui.plan.text)),
    h("dl", { class: "facts" },
      h("dt", {}, "Scope"), h("dd", {}, scope),
      h("dt", {}, "Existing operations"),
      h("dd", {}, h("ol", { class: "ops" },
        h("li", {}, h("code", {}, "duplicateFrame"), ` frame ${n} → new frame ${n + 1}`),
        h("li", {}, h("code", {}, "setFrameDialogue"), ` frame ${n + 1} → Silent · Молчание`),
        h("li", {}, h("code", {}, "placement"), ` panel ${n + 1}.1 → zoom 1.30×`))),
      h("dt", {}, "Structural changes"), h("dd", {}, `+1 frame; frames after ${n} renumber`),
      h("dt", {}, "Image generations"), h("dd", {}, "0 provider calls"),
      h("dt", {}, "Undo"), h("dd", {}, "Applied as one undoable step")),
    h("div", { class: "plan-actions", "data-note-host": "" },
      h("button", {
        type: "button",
        class: "primary stub",
        on: { click: (event) => act(event.currentTarget, { op: "future:applyPlan" }) },
      }, "Apply", h("span", { class: "stub-mark", "aria-hidden": "true" }, "◌")),
      h("button", { type: "button", class: "quiet", on: { click: () => { ui.plan = null; render(); } } }, "Discard")));
}

// ---- warnings, render loop, boot ----------------------------------------------

function renderWarnings(warnings) {
  const node = $("#warnings");
  node.hidden = warnings.length === 0;
  node.replaceChildren(...(warnings.length ? [h("details", {},
    h("summary", {}, `${warnings.length} snapshot note${warnings.length === 1 ? "" : "s"}`),
    h("ul", {}, warnings.map((warning) => h("li", {}, warning))))] : []));
}

function render() {
  const frames = currentFrames();
  const stages = deriveStages({ model, frames, visualApproved: store.visualApproved, dirty: store.dirty });
  renderTopbar(frames, stages);
  let view = null;
  if (ui.editorOpen) view = editorView(frames);
  if (!view) {
    if (ui.stage === "story") view = storyView(stages);
    else if (ui.stage === "characters") view = charactersView(stages);
    else if (ui.stage === "visual") view = visualView(frames, stages);
    else if (ui.stage === "video") view = videoView(frames, stages);
    else view = storyboardView(frames, stages);
  }
  const host = $("#stage-view");
  const scrollTop = window.scrollY;
  host.replaceChildren(view);
  document.body.dataset.editor = ui.editorOpen ? "open" : "closed";
  renderInspector(frames);
  renderPlan(frames);
  window.scrollTo({ top: scrollTop });
  if (ui.scrollToSelection) {
    ui.scrollToSelection = false;
    document.querySelector(".frame-card.selected")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

async function boot() {
  let raw = null;
  try {
    const response = await fetch("/data/snapshot.json", { cache: "no-store" });
    if (response.ok) raw = await response.json();
  } catch {
    raw = null;
  }
  const loaded = loadSnapshot(raw, { assetBase: "/data/" });
  model = loaded.model;
  store = createStore(model);
  store.subscribe((result) => {
    if (result.selection || result.changed) render();
  });
  renderWarnings(loaded.warnings);

  $("#undo").addEventListener("click", () => {
    const result = store.dispatch({ op: "undoStoryboardEdit" });
    if (result.ok) toast(`Undone: ${result.undone.label}${result.undone.displayNumber ? ` · frame ${result.undone.displayNumber}` : ""}`);
  });
  $("#reset").addEventListener("click", () => {
    store.dispatch({ op: "resetToSnapshot" });
    toast("Restored the snapshot. All prototype edits were discarded.");
  });
  $("#assistant-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("#assistant-input");
    const text = input.value.trim();
    if (!text) {
      input.focus();
      return;
    }
    ui.plan = { text };
    render();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && ui.editorOpen && !event.target.closest?.("input, textarea, select")) closeEditor();
  });
  render();
}

boot();
