import fs from "fs";
import path from "path";

// getAllFiles will list all files recursively from the given directory
export function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  const normalizedDirPath = dirPath.replace(/\\/g, "/");

  const files = fs.readdirSync(normalizedDirPath);

  files.forEach((file) => {
    const filePath = path.join(normalizedDirPath, file).replace(/\\/g, "/");

    if (fs.statSync(filePath).isDirectory()) {
      getAllFiles(filePath, arrayOfFiles);
    } else {
      // Add file to our array
      arrayOfFiles.push(filePath);
    }
  });

  return arrayOfFiles;
}
