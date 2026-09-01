import { cp, mkdir, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const outputDirectory = join(projectRoot, "dist");

if (dirname(outputDirectory) !== projectRoot || basename(outputDirectory) !== "dist") {
  throw new Error("La carpeta de salida no es segura.");
}

await rm(outputDirectory, {recursive:true,force:true});
await mkdir(outputDirectory, {recursive:true});

for (const file of ["index.html", "styles.css", "app.js", "enzo.html", "enzo.css", "enzo.js"]) {
  await cp(join(projectRoot, file), join(outputDirectory, file));
}

await cp(join(projectRoot, "lib"), join(outputDirectory, "lib"), {recursive:true});
await cp(join(projectRoot, "public"), join(outputDirectory, "public"), {recursive:true});

console.log("Aplicación preparada en dist.");
