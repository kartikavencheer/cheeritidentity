process.env.DATABASE_URL ||= (() => { throw new Error("Set DATABASE_URL to the Score database connection string (not stored in this file)"); })();
process.env.CHEERIT_API_URL = "http://localhost:4400"; process.env.CHEERIT_CREATE_EVENTS = "on"; process.env.CHEERIT_ORG_ID = "11111111-1111-4111-8111-111111111111";
const { PrismaClient } = await import("/Volumes/MACDISK/kartik/WEBSITES/CheerIT-Score-cheer/backend/node_modules/@prisma/client/index.js");
const prisma = new PrismaClient();
const { registerCheeritEvent } = await import("/Volumes/MACDISK/kartik/WEBSITES/CheerIT-Score-cheer/backend/server/cheeritEvent.ts");
registerCheeritEvent({ get() {} } as any, { prisma });
await new Promise((r) => setTimeout(r, 14000));
process.exit(0);
