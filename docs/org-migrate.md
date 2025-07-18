# GitHub Organization Migration Plan

This document outlines the migration process for moving the VibeTunnel repository from `amantus-ai/vibetunnel` to `vibetunnel/vibetunnel`.

## 1. Fast-lane Transfer (GitHub Built-in Method)

The simplest approach using GitHub's native transfer feature:

1. Navigate to **Settings → General → Danger Zone → Transfer**
2. Enter the new owner: `vibetunnel`
3. Type the repository name to confirm
4. Accept the invite from the destination org
5. Done! ✅

### What Transfers Automatically

✅ **Code & History**
- All branches and commit history
- Git tags and annotated tags

✅ **Project Management**
- Issues and pull requests (with all comments)
- Projects (classic and new)
- Releases and release assets
- Milestones and labels

✅ **Community Features**
- Stars and watchers
- Wiki content
- Fork relationships

✅ **Security & Integration**
- Webhooks configurations
- Deploy keys
- Repository-level secrets
- GitHub Actions workflows
- Git LFS objects (copied in background)

### What Needs Manual Updates

⚠️ **Organization-level Settings**
- Branch protection rules (inherits new org defaults - review carefully)
- Organization-level secrets (must recreate in new org)
- Environment-level secrets (if used outside repo scope)
- Team permissions (reassign in new org structure)

⚠️ **External Integrations**
- CI/CD systems with hardcoded URLs
- Documentation with repository links
- Package registries (npm, etc.)
- External webhooks
- Status badges in README

## 2. Zero-Downtime Migration Checklist

### Pre-Migration (1-2 days before)

- [ ] **Prepare Target Organization**
  - Create `vibetunnel` organization if not exists
  - Set up teams and permissions structure
  - Configure organization-level settings
  - Review default branch protection rules

- [ ] **Audit Current Setup**
  - Document all webhooks and integrations
  - List organization/environment secrets
  - Note branch protection rules
  - Identify external services using the repo

- [ ] **Notify Stakeholders**
  - Team members about the migration
  - Users via issue/discussion if needed
  - Update any public documentation

### Migration Day

- [ ] **Pause Activity (Optional but Recommended)**
  - Merge or close active PRs
  - Create a migration tag: `pre-migration-snapshot`
  - Announce brief maintenance window

- [ ] **Execute Transfer**
  - Perform the GitHub transfer
  - Accept invitation immediately
  - Verify all content transferred

- [ ] **Immediate Post-Transfer**
  - Push a test commit to verify write access
  - Check Actions are running
  - Verify webhooks are firing

### Post-Migration Updates

- [ ] **Update Git Remotes**
  ```bash
  # For all local clones
  git remote set-url origin git@github.com:vibetunnel/vibetunnel.git
  
  # Verify the change
  git remote -v
  ```

- [ ] **Update Documentation**
  - README badges and links
  - Installation instructions
  - Contributing guidelines
  - API documentation

- [ ] **Update External Services**
  - CI/CD configurations
  - Package registry URLs
  - Monitoring services
  - Documentation sites

- [ ] **Update Package Configurations**
  ```json
  // package.json
  {
    "repository": {
      "type": "git",
      "url": "git+https://github.com/vibetunnel/vibetunnel.git"
    },
    "bugs": {
      "url": "https://github.com/vibetunnel/vibetunnel/issues"
    },
    "homepage": "https://github.com/vibetunnel/vibetunnel#readme"
  }
  ```

## 3. Redirect Behavior

GitHub automatically sets up redirects:
- `https://github.com/amantus-ai/vibetunnel` → `https://github.com/vibetunnel/vibetunnel`
- Git operations: `git clone git@github.com:amantus-ai/vibetunnel.git` still works
- API calls to old URL redirect automatically

⚠️ **Redirect Limitations**:
- Redirects break if someone creates a new repo at `amantus-ai/vibetunnel`
- Some tools may not follow redirects properly
- Best practice: Update all references ASAP

## 4. Specific VibeTunnel Updates

### Code Updates
- [ ] Update `GITHUB_URL` in `mac/VibeTunnel/version.xcconfig`
- [ ] Update repository URLs in `package.json` files
- [ ] Update any hardcoded GitHub URLs in documentation
- [ ] Update CLAUDE.md references

### Build & Release
- [ ] Update GitHub Actions secrets if needed
- [ ] Verify macOS notarization still works
- [ ] Test release workflow with new repo URL
- [ ] Update Sparkle appcast URLs if applicable

### npm Package
- [ ] Update package.json repository field
- [ ] Consider publishing a patch version with updated URLs
- [ ] Update npm package description if needed

## 5. Rollback Plan

If issues arise:
1. GitHub Support can reverse transfers within a short window
2. Keep the migration tag for reference
3. Document any issues for future reference

## 6. Timeline

**Day 1**: Preparation
- Set up new organization
- Audit current configuration
- Notify team

**Day 2**: Migration
- Morning: Final preparations
- Midday: Execute transfer
- Afternoon: Update configurations

**Day 3**: Verification
- Test all integrations
- Monitor for issues
- Complete documentation updates

## Notes

- GitHub's transfer process is well-tested and reliable
- The automatic redirects provide good backward compatibility
- Most disruption comes from external tools, not GitHub itself
- Consider doing this during a low-activity period

## References

- [GitHub Docs: Transferring a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository)
- [GitHub Docs: About repository transfers](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository#about-repository-transfers)
- [GitHub Docs: Repository redirects](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository#redirects-and-git-operations)