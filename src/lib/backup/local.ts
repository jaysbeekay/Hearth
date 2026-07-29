import { mkdir, readdir, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import { getLocalConfig } from "@/lib/appSettings";

export async function uploadToLocal(data: Buffer, fileName: string): Promise<void> {
  const { path: dir } = await getLocalConfig();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, fileName), data);
}

export async function pruneLocal(retentionCount: number): Promise<void> {
  const { path: dir } = await getLocalConfig();
  const entries = await readdir(dir);
  const files = await Promise.all(
    entries.map(async (name) => {
      const { mtimeMs } = await stat(path.join(dir, name));
      return { name, mtimeMs };
    }),
  );
  const toDelete = files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(retentionCount);
  for (const file of toDelete) {
    await unlink(path.join(dir, file.name));
  }
}
