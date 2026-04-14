import { cp, access } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

async function pathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function copyIfExists(source, destination) {
  if (!(await pathExists(source))) {
    return;
  }

  await cp(source, destination, { recursive: true, force: true });
}

await copyIfExists(resolve(root, ".next/static"), resolve(root, ".next/standalone/.next/static"));
await copyIfExists(resolve(root, "public"), resolve(root, ".next/standalone/public"));
