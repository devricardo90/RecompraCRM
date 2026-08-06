import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

function loadLocalEnvironment() {
  if (process.env.DATABASE_URL || !existsSync(join(process.cwd(), ".env"))) {
    return;
  }

  for (const line of readFileSync(join(process.cwd(), ".env"), "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);

    if (!match || match[1] in process.env) {
      continue;
    }

    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

loadLocalEnvironment();

if (!process.env.DATABASE_URL) {
  console.error("Database connection: FAIL");
  console.error("DATABASE_URL is not set. Copy .env.example to .env or export DATABASE_URL.");
  process.exit(1);
}

const prisma = new PrismaClient();

try {
  await prisma.$queryRaw`SELECT 1`;
  console.log("Database connection: PASS");
} catch (error) {
  console.error("Database connection: FAIL");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
