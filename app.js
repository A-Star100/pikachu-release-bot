const releaseKeywords = [
  "thunderbolt",
  "iron tail",
  "electro ball",
  "volt tackle",
  "quick attack"
];

const versionRegex = /^(release|beta)-(\d+\.\d+\.\d+\.\d+)$/;

// Parses "2.0.0.9" -> [2,0,0,9]
function parseVersion(version) {
  return version.split('.').map(num => parseInt(num, 10));
}

// Increment version array with rollover, carry over if needed
function incrementVersion(versionArray) {
  for (let i = versionArray.length - 1; i >= 0; i--) {
    if (versionArray[i] < 9) {
      versionArray[i]++;
      break;
    } else {
      versionArray[i] = 0;
      // If we're at the leftmost digit and it was 9, overflow to 10
      if (i === 0) {
        versionArray[i] = 10;
      }
    }
  }
  return versionArray;
}


// Compare two version arrays descending
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

  // 1. Fetch all tags (for releases and betas)
  const tagsResp = await context.octokit.repos.listTags({
    owner: repository.owner.login || repository.owner.name,
    repo: repository.name,
    per_page: 100,
  });
  const tags = tagsResp.data.map(tag => tag.name);

  // 2. Fetch all branches starting with 'beta-' (for beta branches)
  const branchesResp = await context.octokit.repos.listBranches({
    owner: repository.owner.login || repository.owner.name,
    repo: repository.name,
    per_page: 100,
  });
  const betaBranches = branchesResp.data
    .map(branch => branch.name)
    .filter(name => name.startsWith('beta-'));

  // Collect all existing versioned refs (tags and branches) that match our patterns
  const versionedRefs = [];

  for (const tag of tags) {
    const match = tag.match(versionRegex);
    if (match) {
      versionedRefs.push({ type: 'tag', name: tag, version: match[2] });
    }
  }
  for (const branch of betaBranches) {
    const match = branch.match(versionRegex);
    if (match) {
      versionedRefs.push({ type: 'branch', name: branch, version: match[2] });
    }
  }

  // Sort versions descending
  versionedRefs.sort((a, b) => {
    const aV = parseVersion(a.version);
    const bV = parseVersion(b.version);
    return compareVersionsDesc(aV, bV);
  });

  // If no previous version found, start at 2.0.0.0
  let baseVersion = [2, 0, 0, 0];
  if (versionedRefs.length > 0) {
    baseVersion = parseVersion(versionedRefs[0].version);
  }

  // Calculate new version by incrementing last digit with rollover
  const newVersionArray = incrementVersion(baseVersion);
  const newVersion = newVersionArray.join('.');

  if (isBeta) {
    // Create a beta branch like beta-x.x.x.x
    const betaBranchName = `beta-${newVersion}`;
    const defaultBranchRef = `refs/heads/${repository.default_branch}`;

    // Get SHA of default branch
    const refData = await context.octokit.git.getRef({
      owner: repository.owner.login || repository.owner.name,
      repo: repository.name,
      ref: defaultBranchRef.replace('refs/', ''), // e.g., "heads/main"
    });
    const baseSha = refData.data.object.sha;

    // Create new beta branch
    await context.octokit.git.createRef({
      owner: repository.owner.login || repository.owner.name,
      repo: repository.name,
      ref: `refs/heads/${betaBranchName}`,
      sha: baseSha,
    });

    // Create draft release for beta
    await context.octokit.repos.createRelease({
      owner: repository.owner.login || repository.owner.name,
      repo: repository.name,
      tag_name: betaBranchName,
      name: `Beta ${newVersion}`,
      body: `Beta release triggered by commit: ${matchingCommit.message}`,
      target_commitish: betaBranchName,
      draft: true,
    });

    context.log.info(`Created beta branch '${betaBranchName}' and draft release.`);
  } else {
    // Create release tag and release
    const tagName = `release-${newVersion}`;

    await context.octokit.repos.createRelease({
      owner: repository.owner.login || repository.owner.name,
      repo: repository.name,
      tag_name: tagName,
      name: `Release ${newVersion}`,
      body: `Triggered by commit: ${matchingCommit.message}`,
      target_commitish: matchingCommit.id,
    });

    context.log.info(`Created release '${tagName}'.`);
  }
});
