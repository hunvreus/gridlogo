# DevOps

## Deployment target

- Platform: Cloudflare Pages
- Project name: `gridlogo`
- Production branch: `main`
- Build command: `pnpm build`
- Build output directory: `dist`
- Runtime: static assets only
- Required environment variables: none
- Required secrets: none
- Storage/database/background jobs: none

## Preferred path: Cloudflare Pages Git integration

Connect the GitHub repository `hunvreus/gridlogo` to Cloudflare Pages.

Recommended Cloudflare Pages settings:

- Framework preset: Vite
- Build command: `pnpm build`
- Build output directory: `dist`
- Production branch: `main`

Cloudflare Pages should then deploy production automatically whenever `main` is pushed.

## Manual deploy path

Use this path when Git integration is not set up yet or when a manual direct upload is needed.

```bash
pnpm install
pnpm build
pnpm deploy:pages
```

`pnpm deploy:pages` runs:

```bash
wrangler pages deploy dist --project-name gridlogo --branch main
```

This command creates or updates a Cloudflare Pages deployment, so run it only when you intend to publish.

## Validation

Before deploying:

```bash
pnpm build
```

After deploying:

- Open the production Pages URL.
- Verify the app loads.
- Add a few shapes.
- Toggle preview.
- Download SVG and PNG.
- Reload the URL and verify URL-hash state restoration.

## Rollback

Cloudflare Pages keeps prior deployments. Roll back from the Cloudflare dashboard:

1. Open Workers & Pages.
2. Select the `gridlogo` Pages project.
3. Open Deployments.
4. Promote a known-good previous deployment.

For source rollback, revert the bad commit on `main` and push the revert.
