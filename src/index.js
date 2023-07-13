import fs from "fs";
import path from "path";
import core from "@actions/core";
import github from "@actions/github";
import {
  handleBranchesOption,
  handleDryRunOption,
  handleExtends,
} from "./handleOptions.js";
import outputs from "./outputs.js";
import inputs from "./inputs.js";

/**
 * @typedef {import('semantic-release').Result} Result
 */

/**
 * Release main task
 * @returns {Promise<void>}
 */
const release = async () => {
  core.setOutput(outputs.new_release_published, "false");

  const { default: semanticRelease } = await import("semantic-release");
  if (handleDryRunOption().dryRun) {
    // make semantic-release believe we're running on master
    process.env.GITHUB_EVENT_NAME = "totally-not-a-pr";
    process.env.GITHUB_REF = "master";
  }
  if (core.getInput(inputs.working_directory)) {
    process.chdir(core.getInput(inputs.working_directory));
  }
  const npmPublish = core.getInput(inputs.npm_publish) === "true";
  const registry =
    core.getInput(inputs.registry) || "https://registry.npmjs.com/";

  /** @type {(string | [string, any])[]} */
  const plugins = [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/github",
  ];
  // only use npm plugin if there is a package.json, or if publish flag is on
  if (
    fs.existsSync(path.join(process.env.GITHUB_WORKSPACE, "package.json")) ||
    npmPublish
  ) {
    plugins.push([
      "@semantic-release/npm",
      {
        npmPublish,
      },
    ]);
  }
  process.env.NPM_CONFIG_REGISTRY = registry;
  // remap NODE_AUTH_TOKEN to NPM_TOKEN, in case action runs without
  // the actions/setup-node step before it.
  if (process.env.NODE_AUTH_TOKEN && !process.env.NPM_TOKEN) {
    process.env.NPM_TOKEN = process.env.NODE_AUTH_TOKEN;
  }

  const result = await semanticRelease({
    ...handleBranchesOption(),
    ...handleDryRunOption(),
    ...handleExtends(),
    plugins,
  });

  await collectOutput(result);
  await updateStatus(result);
};

const updateStatus = async (/** @type {Result} */ result) => {
  const checkName = core.getInput(inputs.check_name);

  if (!checkName) {
    return;
  }

  const octokit = github.getOctokit(process.env.GITHUB_TOKEN);
  const [gitHubRepoOwner, gitHubRepoName] =
    process.env.GITHUB_REPOSITORY.split("/");

  //
  let gitHubSha = process.env.GITHUB_SHA;
  try {
    const event = JSON.parse(
      fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf-8")
    );
    gitHubSha = event.pull_request.head.sha;
  } catch (e) {
    core.debug("Could not get PR sha, using env.GITHUB_SHA for status");
  }

  const linkToCommitStyle =
    "[conventional](https://www.conventionalcommits.org/) [commits](https://github.com/semantic-release/semantic-release#how-does-it-work)";
  let title = "No new release";
  let summary = `No new release will be published. Add some ${linkToCommitStyle} if you intend to release these changes.`;
  if (result && result.nextRelease) {
    title = `${result.nextRelease.type.replace(/^./, (s) =>
      s.toUpperCase()
    )} release (${result.nextRelease.version})`;
    summary = [
      `Found the following ${linkToCommitStyle} to trigger a ${result.nextRelease.type} release.`,
      result.nextRelease.notes,
    ].join("\n\n");
  }

  await octokit.rest.checks.create({
    owner: gitHubRepoOwner,
    repo: gitHubRepoName,
    name: checkName,
    head_sha: gitHubSha,
    status: "completed",
    conclusion: "success",
    output: {
      title,
      summary,
    },
  });
};

const collectOutput = async (result) => {
  if (!result) {
    core.debug("No release published.");
    return Promise.resolve();
  }

  const { lastRelease, commits, nextRelease, releases } = result;

  if (!nextRelease) {
    core.debug("No release published.");
    return Promise.resolve();
  }

  core.debug(
    `Published ${nextRelease.type} release version ${nextRelease.version} containing ${commits.length} commits.`
  );

  if (lastRelease.version) {
    core.debug(`The last release was "${lastRelease.version}".`);
  }

  for (const release of releases) {
    core.debug(
      `The release was published with plugin "${release.pluginName}".`
    );
  }

  const { version, channel, notes } = nextRelease;
  const [major, minor, patch] = version.split(/\.|-|\s/g, 3);

  // set outputs
  core.setOutput(outputs.new_release_published, "true");
  core.setOutput(outputs.new_release_version, version);
  core.setOutput(outputs.new_release_major_version, major);
  core.setOutput(outputs.new_release_minor_version, minor);
  core.setOutput(outputs.new_release_patch_version, patch);
  core.setOutput(outputs.new_release_channel, channel);
  core.setOutput(outputs.new_release_notes, notes);
};

export const run = () => {
  core.debug("Initialization successful");
  release().catch((err) => {
    console.error(err);
    core.setFailed("Failed to run semantic-release");
  });
};
