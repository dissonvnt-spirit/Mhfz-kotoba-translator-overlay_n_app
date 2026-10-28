const { rmSync } = require("node:fs");

if (!(process.env.npm_config_user_agent || "").startsWith("pnpm/")) {
  console.error("Use pnpm instead.");
  process.exit(1);
}

for (const filename of ["package-lock.json", "yarn.lock"]) {
  rmSync(filename, { force: true });
}
