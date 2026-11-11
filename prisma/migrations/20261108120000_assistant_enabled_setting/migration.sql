-- The AI assistant is now opt-in with its own household switch
-- ("assistant.enabled"), off unless chosen at setup or in Settings.
-- Households that had already configured an assistant provider keep it on.
INSERT OR IGNORE INTO "app_settings" ("key", "value", "encrypted", "updatedAt")
SELECT 'assistant.enabled', 'true', 0, CURRENT_TIMESTAMP
WHERE EXISTS (
  SELECT 1 FROM "app_settings"
  WHERE "key" = 'chat.provider' AND "value" IS NOT NULL AND "value" <> ''
);
