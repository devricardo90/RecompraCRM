/**
 * Deliberately credential-shaped fixtures for the secrets-hygiene guard.
 *
 * This file exists so the guard's rejection rules can be proved. Proving a
 * guard rejects violations requires violating examples, and a guard that
 * scans tracked files trips on its own examples — that happened six times
 * during TASK-16 before this file existed, each time resolved by adding an
 * allowlist entry, which is the failure mode the allowlist design was meant
 * to avoid.
 *
 * So the guard excludes exactly this one path, the exclusion is narrow and
 * named, and `scripts/task-16-guards-check.mjs` asserts both that the
 * exclusion exists and that it covers only this file. An exclusion that
 * widened silently would be worse than the allowlist growth it replaced.
 *
 * Nothing here is a real credential. Every value is invented for the test.
 */

/**
 * The keeper: a violation that the test allowlist then excuses. Allowlist
 * entries are only marked matched when a rule fires and consults them, so a
 * keeper with clean content would leave the entry unmatched and trip the
 * staleness rule in every test.
 */
export const KEEPER = { path: "keep.txt", literal: "kept-literal", body: "postgresql://u:kept-literal@h:1/d" };

export const REJECT_FIXTURES = {
  trackedEnvFile: { path: ".env", body: "X=1" },
  trackedEnvVariant: { path: ".env.production", body: "X=1" },
  allowedEnvExample: { path: ".env.example", body: "PORT=5432" },

  connectionUrl: { path: "cfg.txt", body: "postgresql://u:s3cret@host:5432/db" },

  pemKey: { path: "k.pem", body: "-----BEGIN RSA PRIVATE KEY-----" },
  jsonToken: { path: "deploy.json", body: '{ "VERCEL_TOKEN": "abcd1234efgh" }' },
  placeholderToken: { path: "ok.env", body: "API_TOKEN=changeme" },
  secretReference: { path: "ok.yml", body: "API_TOKEN: ${{ secrets.API_TOKEN }}" },

  inlinedWorkflowSecret: { path: ".github/workflows/w.yml", body: "  MY_TOKEN: literalvalue123" },

  envExampleRealSecret: { path: ".env.example", body: "POSTGRES_PASSWORD=realpassword123" },
  envExampleOrdinary: { path: ".env.example", body: "POSTGRES_USER=recompra\nPOSTGRES_PORT=5432" },
};
