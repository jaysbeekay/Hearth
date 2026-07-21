-- AlterTable
ALTER TABLE "users" ADD COLUMN "chatApiKeyEncrypted" TEXT;
ALTER TABLE "users" ADD COLUMN "chatModel" TEXT;
ALTER TABLE "users" ADD COLUMN "chatProvider" TEXT;

-- CreateTable
CREATE TABLE "chat_threads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "chat_threads_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolCalls" TEXT,
    "toolCallId" TEXT,
    "toolName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "chat_threads" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "chat_threads_createdById_idx" ON "chat_threads"("createdById");

-- CreateIndex
CREATE INDEX "chat_messages_threadId_idx" ON "chat_messages"("threadId");
