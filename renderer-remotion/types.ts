// Types mirroring schema/storyboard.schema.json. Keep in sync with the schema;
// the schema is authoritative and is what the validator enforces.

export type Asset =
  | { kind: 'placeholder'; visibleDescription: string; generationPrompt: string }
  | { kind: 'file'; path: string; checksum?: string; width?: number; height?: number; generationPrompt?: string };

export type Shot = 'wide' | 'medium' | 'close' | 'extreme';

export type Beat =
  | 'listItem' | 'acknowledgement' | 'quickBeat' | 'ordinary'
  | 'silentReaction' | 'emphasis' | 'punchline' | 'explanation' | 'longExplanation';

export type ExpressionEntry = {
  id: string;
  label: string;
  descriptor: {
    valence: 'positive' | 'negative' | 'neutral' | 'fearful' | 'comedic';
    intensity: 1 | 2 | 3;
    mouth: 'closed' | 'slightly-open' | 'open-speaking' | 'open-wide';
    gaze: 'to-camera' | 'screen-left' | 'screen-right' | 'up' | 'down' | 'away';
    headOrientation: 'frontal' | 'three-quarter-left' | 'three-quarter-right' | 'profile-left' | 'profile-right' | 'tilted-back';
    gesture?: 'none' | 'raised-finger' | 'open-hand' | 'both-hands' | 'closed-fist' | 'arms-crossed';
  };
  suitableFor: ('speaking' | 'listening' | 'reaction' | 'titleCard')[];
  flipSafe?: boolean;
  asset: Asset;
};

export type PanelForeground = {
  backgroundColor?: string;
  extractionStatus?: 'candidate-pass' | 'review' | 'reject' | 'failed' | 'not-extracted';
  drawAsset?: Asset;
};

export type Panel =
  | ({ kind: 'character'; characterId: string; expressionId: string; shot: Shot; flipHorizontal?: boolean; focalPoint?: { x: number; y: number } } & PanelForeground)
  | ({ kind: 'insert'; label?: string; asset: Asset; shot: Shot; flipHorizontal?: boolean } & PanelForeground);

export type Line = {
  id: string;
  speakerId: string;
  text: string;
  beat: Beat;
  preRollFrames: number;
  revealFrames: number;
  holdFrames: number;
  intent?: string;
};

export type Transition = { kind: 'cut' | 'crossfade' | 'fadeFromBlack'; durationFrames?: number };

export type DialogueScene = {
  id: string; kind: 'dialogue';
  layout: 'single' | 'split2' | 'split3';
  panels: Panel[];
  lines: Line[];
  transitionIn: Transition;
  extraHoldFrames?: number;
  durationFrames: number;
  devices?: string[];
  deliberateReaction?: boolean;
  reason?: string;
};

export type TextCardScene = {
  id: string; kind: 'textCard';
  variant?: 'interstitial' | 'outro' | 'chapter';
  lines: string[];
  transitionIn: Transition;
  durationFrames: number;
  devices?: string[];
};

export type TemplateScene = {
  id: string; kind: 'template';
  templateId: string;
  slots: Record<string, string | string[] | Asset>;
  transitionIn: Transition;
  durationFrames: number;
  devices?: string[];
};

export type Scene = DialogueScene | TextCardScene | TemplateScene;

export type Theme = {
  backgroundColor?: string;
  panelGutterPx?: number;
  dialogueBarHeightPx?: number;
  dialogueBarColor?: string;
  dialogueBarBorderColor?: string;
  textColor?: string;
  fontFamily?: string;
  fontFile?: string | null;
};

export type Storyboard = {
  schemaVersion: string;
  minimumRendererVersion?: number;
  requiredFeatures?: string[];
  project: {
    id: string; title?: string; language: string;
    targetDurationSeconds?: number;
    width: number; height: number; fps: number;
    totalDurationFrames: number;
    timing: { charactersPerSecond: number; preRollFrames: number; beatHoldFrames: Record<string, number> };
  };
  style: { presetId: string; kenBurnsScale?: number };
  theme?: Theme;
  characters: { id: string; displayName: string; role?: string; traits?: string; storyFunction?: string }[];
  expressionSheets: { characterId: string; basePortraitId?: string; entries: ExpressionEntry[] }[];
  scenes: Scene[];
  proposedDevices?: unknown[];
  notes?: Record<string, unknown>;
};
