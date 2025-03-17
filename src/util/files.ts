import fs from "fs";
import path from "path";

// getAllFiles will list all files recursively from the given directory
export function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  const files = fs.readdirSync(dirPath, { recursive: true }) as string[];

  files.forEach((file) => {
    const filePath = path.posix.join(dirPath, file);
    if (!fs.statSync(filePath).isDirectory()) {
      arrayOfFiles.push(filePath);
    }
  });

  return arrayOfFiles;
}
