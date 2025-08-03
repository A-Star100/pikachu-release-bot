/**
 * @param {import('probot').Probot} app
 */

// pikachu yayyyy

module.exports = (app) => {
const releaseKeywords = [
  "thunderbolt",
  "iron tail",
  "electro ball",
  "volt tackle",
  "quick attack"
];

const versionRegex = /^(release|beta)-(\d+\.\d+\.\d+\.\d+)$/;

function parseVersion(version) {
  return version.split('.').map(num => parseInt(num, 10));
}

function incrementVersion(versionArray) {
  for (let i = versionArray.length - 1; i >= 0; i--) {
    if (versionArray[i] < 9) {
      versionArray[i]++;
      break;
    } else {
      versionArray[i] = 0;
      if (i === 0) {
        versionArray[i] = 10;
      }
    }
  }
  return versionArray;
}

function compareVersionsDesc(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return b[i] - a[i];
  }
  return 0;
}

app.on("push", async (context) => {
  const { commits, ref, repository } = context.payload;

  if (ref !== `refs/heads/${repository.default_branch}`) return;

  // Find a commit that has one of the release keywords
  const matchingCommit = commits.find(commit =>
    releaseKeywords.some(keyword =>
      commit.message.toLowerCase().includes(keyword)
    )
  );
  if (!matchingCommit) return;

  const isBeta = matchingCommit.message.toLowerCase().includes("beta");

  // 1. Fetch all tags only
  const tagsResp = await context.octokit.repos.listTags({
    owner: repository.owner.login || repository.owner.name,
    repo: repository.name,
    per_page: 100,
  });
  const tags = tagsResp.data.map(tag => tag.name);

  // Collect all existing versioned tags that match our pattern
  const versionedTags = tags
    .map(tag => {
      const match = tag.match(versionRegex);
      if (match) {
        return { name: tag, type: match[1], version: match[2] };
      }
      return null;
    })
    .filter(Boolean);

  // Sort versions descending
  versionedTags.sort((a, b) => {
    const aV = parseVersion(a.version);
    const bV = parseVersion(b.version);
    return compareVersionsDesc(aV, bV);
  });

  // If no previous version found, start at 2.0.0.0
  let baseVersion = [1, 0, 0, 0];
  if (versionedTags.length > 0) {
    baseVersion = parseVersion(versionedTags[0].version);
  }

  // Calculate new version by incrementing last digit with rollover
  const newVersionArray = incrementVersion(baseVersion);
  const newVersion = newVersionArray.join('.');

  const tagName = isBeta ? `beta-${newVersion}` : `release-${newVersion}`;

  // Create annotated tag pointing to the commit SHA
  await context.octokit.git.createTag({
    owner: repository.owner.login || repository.owner.name,
    repo: repository.name,
    tag: tagName,
    message: `${isBeta ? 'Beta' : 'Release'} ${newVersion} triggered by commit: ${matchingCommit.message}`,
    object: matchingCommit.id,
    type: "commit",
  });

  // Create reference for the new tag
  await context.octokit.git.createRef({
    owner: repository.owner.login || repository.owner.name,
    repo: repository.name,
    ref: `refs/tags/${tagName}`,
    sha: matchingCommit.id,
  });

  // Create release (draft if beta)
  await context.octokit.repos.createRelease({
    owner: repository.owner.login || repository.owner.name,
    repo: repository.name,
    tag_name: tagName,
    name: `${isBeta ? 'Beta' : 'Release'} ${newVersion}`,
    body: `${isBeta ? 'Beta' : 'Release'} triggered by commit: ${matchingCommit.message}`,
    target_commitish: matchingCommit.id,
    draft: isBeta,
  });

  context.log.info(`Created ${isBeta ? 'beta' : 'release'} tag and release: '${tagName}'.`);
});
};
