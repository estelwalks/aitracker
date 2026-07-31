const readline = require("node:readline");

async function prompt(label) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const value = await new Promise((resolve) => rl.question(label, resolve));
  rl.close();
  return String(value || "").trim();
}

async function promptHidden(label) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  const value = await new Promise((resolve) => {
    rl._writeToOutput = function _writeToOutput() {};
    rl.question(label, (answer) => resolve(answer));
  });
  rl.close();
  return String(value || "").trim();
}

module.exports = { prompt, promptHidden };
