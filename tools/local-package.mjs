import { resolve, dirname } from "node:path";
import { stat } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

async function getZipTask() {
  const require = createRequire(import.meta.url);
  const coreBuild = require("@minecraft/core-build-tasks");
  const task = coreBuild.zipTask || coreBuild["zipTask"];
  if (!task) throw new Error("zipTask not found in @minecraft/core-build-tasks");
  return task;
}

async function main() {
  const config = JSON.parse(await readFile("./bkit.config.json", "utf8"));
  const rootDir = config.paths?.root ? resolve(config.paths.root) : process.cwd();
  const buildDir = resolve(rootDir, config.build?.outDir ?? "dist");
  const behaviorEnabled = config.packSelection?.behavior !== false;
  const resourceEnabled = config.packSelection?.resource !== false;
  const behaviorPath = behaviorEnabled ? resolve(buildDir, config.packs.behavior) : null;
  const resourcePath = resourceEnabled ? resolve(buildDir, config.packs.resource) : null;

  const st = await stat(buildDir);
  if (!st.isDirectory()) throw new Error(`Build directory not found: ${buildDir}`);

  const baseName = config.project?.name ?? "addon";
  const behaviorOut = resolve(buildDir, `${baseName}_behavior.mcpack`);
  const resourceOut = resolve(buildDir, `${baseName}_resource.mcpack`);
  const zipTask = await getZipTask();

  if (behaviorEnabled && behaviorPath) {
    await zipTask(behaviorOut, [{ contents: [behaviorPath], targetPath: "" }])((err) => {
      if (err) throw err;
    });
    console.log(`[local] behavior mcpack -> ${behaviorOut}`);
  }
  if (resourceEnabled && resourcePath) {
    await zipTask(resourceOut, [{ contents: [resourcePath], targetPath: "" }])((err) => {
      if (err) throw err;
    });
    console.log(`[local] resource mcpack -> ${resourceOut}`);
  }
  if (behaviorEnabled && resourceEnabled && behaviorPath && resourcePath) {
    const addonOut = resolve(buildDir, `${baseName}.mcaddon`);
    await zipTask(addonOut, [
      { contents: [behaviorPath], targetPath: "behavior_pack" },
      { contents: [resourcePath], targetPath: "resource_pack" },
    ])((err) => {
      if (err) throw err;
    });
    console.log(`[local] mcaddon -> ${addonOut}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
