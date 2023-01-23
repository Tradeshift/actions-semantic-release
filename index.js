import path from "path";
import util from "util";
import { exec as nodeExec } from "child_process";

const exec = util.promisify(nodeExec);

const run = async () => {
  // Install Dependencies
  {
    const __dirname = new URL(".", import.meta.url).pathname;
    const { stdout, stderr } = await exec("npm ci --only=prod --silent", {
      cwd: path.resolve(__dirname),
    });
    console.log(stdout);
    if (stderr) {
      return Promise.reject(stderr);
    }
  }

  (await import("./src/index.js")).run();
};

run().catch((err) => {
  process.exitCode = 1;
  console.error(err);
});
