# Integrated intro templates

## Status

Production contract for Feature 016. One owner-operated browser and video checkpoint. This does not rewrite Feature 011. Feature 011 remains the body-render baseline; its historical note that intro and title templates were out of scope for that feature stays as history.

## Choice

In **Собрать текущую раскадровку**, beside the transition choice, the owner picks one intro for the render they are about to start:

| Choice | Meaning |
| --- | --- |
| **Без интро** | The current storyboard is compiled and rendered exactly as it is today. This is the default. |
| **Осколки истории** | Template `story-shards-v1`, version 1, is placed in front of that same storyboard inside one video. |

The control is a labeled native selector. The template name, version, and length come from the current project’s server catalog. The page does not keep a second copy of that identity.

**Без интро** is the absence of a template. It is not a catalog entry.

The choice is remembered only until the next render request, the same way the transition choice is. It does not edit frames, fork a storyboard version, enter Undo, drop Visual approval, or change source dialogue. It is not saved as a project preference.

## What the intro is allowed to use

The selected template is filled only from the current project:

- the project title;
- canonical character names in the included cast;
- each participating character’s approved anchor;
- distinct images already assigned to that character’s current panels.

There is no second title form, no name form, and no intro upload. The browser sends the template choice only. A title, a name, or an image id supplied by the browser is ignored.

## When Осколки истории can be used

`story-shards-v1` is available only when the current ready Visual state has exactly two or three participating characters, each with an approved anchor.

A participating character is an included canonical character whose exact current panel subject appears in the storyboard. Order is the first such appearance while walking frames and panels in display order. Characters who never appear are not participating. A subject that is not an exact included canonical name is ignored.

| Situation | Осколки истории | Без интро |
| --- | --- | --- |
| Exactly two or three participating characters, title present, each has an approved anchor, and every intro image belongs to this project | Available | Available |
| One participating character, or more than three | Unavailable, with a short Russian reason. The first three are not silently kept. | Available |
| No participating character, no project title, a participating character without an approved anchor, or an intro image that is not this project’s | Unavailable, with a specific Russian reason, before rendering starts | Available |
| Unknown template id or a version this catalog does not publish | Rejected before rendering starts | Available |

Two characters get three image shards each. Three characters get two each. For each character the images are chosen in this order: the approved anchor, then distinct current panel images for that exact subject, in frame and panel order, with duplicate asset ids removed. Empty shard slots reuse that character’s approved anchor. No new image is generated and no asset id is invented.

The catalog is the one list later templates extend. This feature ships only `story-shards-v1`.

## One video

The path is: current project, its current assets, and the render options become one renderer-independent Video Spec, optionally with an intro segment, then the current Remotion adapter encodes one MP4.

The intro is 201 frames at 30 fps. Those frames are added to the displayed runtime and to the total length. Every body frame keeps its own length and its body-to-body transition. Each body frame starts 201 frames later. The join from the intro to the first body frame is a hard cut after the intro has closed to black. Cross dissolve still applies only between eligible body frames.

With **Без интро**, the Video Spec keeps today’s body frames, start times, durations, transitions, and total length, and it has no intro segment.

The intro segment names the template and version, carries the resolved title and the fixed eyebrow **ВИДЕОКОМИКС**, the ordered canonical names, and six shard slots with character and project-scoped image references. It does not carry a React component, stylesheet, or a separate intro file.

The renderer draws the slots it is given. It does not search again for the title, the names, the order, or the images. An unknown template or version fails instead of falling through to another opener. The picture stays 1920×1080 at 30 fps. Preview and download are the same single file.

No language-model call and no image-provider call are part of choosing, resolving, or compiling the intro.

## What Осколки истории looks like

The accepted reference is the revised story-shards opener: six polygonal images arrive and settle, a short pause follows, then large character names, then the project title. **ВИДЕОКОМИКС** is muted gray. The project title is warm light gold. Name underlines are white or gray and do not color-code characters. There is no diagonal opening flash. Distinct images of the same character are used when the project has them. The opener closes to black before the first storyboard frame.

The reference was drawn at 1280×720. The product frame is 1920×1080. The motion is translated, not stretched from the reference file, and the reference renderer is not part of the product.

## Research trace

A render records the selected template id and version on both the start and the terminal research event. **Без интро** records an empty choice. The trace does not record source dialogue, prompts, image bytes, credentials, or secret-bearing URLs.

## Owner checkpoint

Offline tests do not accept this feature. The owner starts the render and watches the file.

1. **Без интро** is selected by default, shows the previous runtime, and renders the previous way.
2. **Осколки истории** can be selected from the catalog and the runtime grows by 201 frames.
3. The opener shows this project’s title and canonical names.
4. Six shards use this project’s images, including distinct images when the project has them.
5. The shards finish entering before the names become prominent. The title follows the names.
6. The names are large, with neutral white or gray underlines.
7. **ВИДЕОКОМИКС** is muted gray and the title is warm light gold.
8. Characters are not color-coded, and there is no diagonal opening flash.
9. The opener closes to black and the first storyboard frame begins cleanly. Body cross dissolves still behave when that transition is selected.
10. Preview and download are the same single MP4.

Compare shard assembly, the names, the title lock-up, the close to black, and the first storyboard frame with the manual reference. Code inspection is not that comparison.

## Protected

Feature 011 body assembly and undo, Feature 013 project isolation, Feature 015 dialogue modes, source text, panel ownership, Visual approval, image generation, and the current asset-assignment rules.

## Out of scope

Further intro templates, an intro-only render, joining two MP4 files, a durable intro preference, a database migration, intro image generation or upload, title or name editing, a second render button, queues, cancellation, and the deferred source-draft editor issue.
