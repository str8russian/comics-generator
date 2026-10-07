const root = new URL("../../../", import.meta.url);

const files = {
  "/overflow.mjs": "app/storyboard-web/overflow.mjs",
  "/frame-renderer.mjs": "prototypes/storyboard-viewer/frame-renderer.mjs",
  "/draft-autosave.mjs": "app/storyboard-web/public/draft-autosave.mjs",
  "/app.js": "app/storyboard-web/public/app.js",
};

export async function resolve(specifier, context, nextResolve) {
  const file = files[specifier];
  if (!file) return nextResolve(specifier, context);
  return {
    url: new URL(file, root).href,
    shortCircuit: true,
  };
}
