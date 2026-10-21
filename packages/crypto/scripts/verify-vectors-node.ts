import { verifyVectors } from "./verify-vectors";

const report = await verifyVectors("node");
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report));
} else {
  for (const field of report.fields) {
    console.log(`${field.pass ? "PASS" : "FAIL"} ${field.field}`);
  }
  console.log(report.pass ? "ALL PASS (node)" : "FAILED (node)");
}
process.exit(report.pass ? 0 : 1);
