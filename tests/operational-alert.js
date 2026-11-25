const fs = require("fs");

const status = process.argv[2] || "unknown";
const workflow = process.env.GITHUB_WORKFLOW || "Handy operations";
const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID || ""}`
  : null;

function statusLabel(value) {
  if (value === "success") return "Passed";
  if (value === "failure") return "Failed";
  if (value === "cancelled") return "Cancelled";
  return "Status unknown";
}

function writeSummary() {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  const lines = [
    "## Handy operational status",
    "",
    `- **Workflow:** ${workflow}`,
    `- **Status:** ${statusLabel(status)}`
  ];
  if (runUrl) lines.push(`- **Run:** ${runUrl}`);
  fs.appendFileSync(summaryPath, `${lines.join("\n")}\n`);
}

async function postWebhook() {
  const webhookUrl = process.env.HANDY_ALERT_WEBHOOK_URL;
  if (!webhookUrl) return;
  try {
    const payload = {
      text: `Handy ${workflow}: ${statusLabel(status)}${runUrl ? `\n${runUrl}` : ""}`
    };
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      console.error(`Operational webhook returned HTTP ${response.status}.`);
    }
  } catch (error) {
    console.error(`Operational webhook could not be delivered: ${error.message}`);
  }
}

async function main() {
  writeSummary();
  await postWebhook();
  console.log(`Operational status recorded: ${statusLabel(status)}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
