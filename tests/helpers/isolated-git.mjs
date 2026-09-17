import { withoutRepositoryGitEnvironment } from '../../scripts/git-environment.mjs';

const clean = withoutRepositoryGitEnvironment(process.env);
for (const name of Object.keys(process.env)) {
  if (!Object.hasOwn(clean, name)) delete process.env[name];
}
