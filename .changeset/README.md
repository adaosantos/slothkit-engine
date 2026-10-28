# Changesets

Every PR that changes a published package should include a changeset:

```bash
pnpm changeset
```

Pick the affected packages, the bump type (patch, minor, major), and write a short summary. It becomes the changelog entry when the packages are released.
