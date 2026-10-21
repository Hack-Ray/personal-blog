// Usage: node scripts/check-snapshot.ts <snapshot dir> [--profile]
// Validates a snapshot with the same parser the build uses; --profile also
// prints the parsed profile as JSON.
export {};
process.env.SITE_DATA_DIR = process.argv[2] ?? process.env.SITE_DATA_DIR;
const { loadSiteContent } = await import("../src/content/load.ts");

const { articles, profile } = loadSiteContent();
const published = articles.filter((a) => a.state === "published").length;
console.log(`ok: ${published} published, ${articles.length - published} archived`);
if (process.argv.includes("--profile")) console.log(JSON.stringify(profile));
