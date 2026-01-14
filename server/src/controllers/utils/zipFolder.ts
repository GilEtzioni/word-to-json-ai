import fs from "fs";
import path from "path";
import archiver from "archiver";

export async function zipFolder(folderPath: string, zipPath: string) {
  await fs.promises.mkdir(path.dirname(zipPath), { recursive: true });

  return new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => resolve());
    output.on("error", reject);

    archive.on("error", reject);
    archive.pipe(output);

    // put the folder contents at the root of the zip
    archive.directory(folderPath, false);

    archive.finalize();
  });
}
