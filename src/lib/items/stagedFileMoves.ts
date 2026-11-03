import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

/**
 * #445 review: copying a staged Item Document's file used to happen inside the
 * legacy write's Prisma transaction. A missing staged copy or a full disk then
 * rolled back a legitimate legacy edit. The canonical write must not depend on
 * the stage's files, so copies are queued during the transaction and done after
 * it commits, best-effort: a failure is logged and left for
 * `scripts/verify-item-stage.ts` to report, like `mirrorStagedDocument`.
 */
export interface StagedFileMove {
  documentId: string;
  from: string;
  to: string;
}

const queue = new AsyncLocalStorage<StagedFileMove[]>();

/**
 * Run a legacy write (normally a `prisma.$transaction`) and copy any staged
 * files it queued once it has resolved. If it throws, nothing is copied.
 */
export async function withStagedFileMoves<T>(run: () => Promise<T>): Promise<T> {
  const moves: StagedFileMove[] = [];
  const result = await queue.run(moves, run);
  await applyStagedFileMoves(moves);
  return result;
}

/** Queue a copy for after the current legacy write commits. */
export function queueStagedFileMove(move: StagedFileMove) {
  const moves = queue.getStore();
  if (moves) {
    moves.push(move);
    return;
  }
  // A writer that isn't wrapped in withStagedFileMoves: never copy inside its
  // transaction. The verifier reports the missing file.
  console.error("[items] staged Document %s not copied: writer isn't wrapped in withStagedFileMoves", move.documentId);
}

const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Copy each queued file. Never throws; a failed copy is logged. */
export async function applyStagedFileMoves(moves: StagedFileMove[]) {
  for (const move of moves) {
    try {
      await mkdir(path.dirname(move.to), { recursive: true });
      try {
        await copyFile(move.from, move.to, constants.COPYFILE_EXCL);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (digest(await readFile(move.from)) !== digest(await readFile(move.to))) {
          throw new Error("a different file is already at the destination");
        }
      }
      // #445 review: a rehomed file is no longer referenced from its old
      // Item directory, so drop it there. Only ever a staged copy under
      // <uploads>/items, never a legacy file.
      if (path.resolve(move.from) !== path.resolve(move.to) && path.basename(path.dirname(path.dirname(move.from))) === "items") {
        await rm(move.from, { force: true });
      }
    } catch (error) {
      console.error("[items] couldn't copy staged Document %s", move.documentId, error);
    }
  }
}
