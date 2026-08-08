-- Replace the name-not-blank constraint with a locale-independent version.
-- The original '[^[:space:]]' pattern depends on the PostgreSQL locale and may
-- accept names composed entirely of Unicode whitespace (e.g. U+00A0 NO-BREAK
-- SPACE, U+2007 FIGURE SPACE, U+202F NARROW NO-BREAK SPACE).
--
-- The new pattern explicitly enumerates every Unicode White_Space code point so
-- the check is deterministic regardless of server locale.
ALTER TABLE "Customer" DROP CONSTRAINT IF EXISTS "Customer_name_not_blank";

ALTER TABLE "Customer"
ADD CONSTRAINT "Customer_name_not_blank"
CHECK ("name" ~ E'[^ \\t\\n\\r\\x0B\\x0C\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]')
NOT VALID;

-- Validate only when every existing row already satisfies the tighter rule.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "Customer"
    WHERE "name" !~ E'[^ \\t\\n\\r\\x0B\\x0C\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]'
  ) THEN
    ALTER TABLE "Customer"
    VALIDATE CONSTRAINT "Customer_name_not_blank";
  END IF;
END
$$;
