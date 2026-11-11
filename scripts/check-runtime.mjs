const [major, minor] = process.versions.node.split(".").map(Number);
if (major !== 22 || minor < 19) {
  console.error(`NEXTVO Admin requires Node.js 22.19.0+ in the 22.x line; received ${process.version}. Select Node.js 22.x in Vercel Settings → Build and Deployment.`);
  process.exit(1);
}
console.log(`NEXTVO Admin build runtime: ${process.version}`);
