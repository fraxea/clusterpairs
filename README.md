# Cluster Pairs Explorer

React + TypeScript + Vite app for visualizing pathway scores per drug using `src/data/sample_results.json`.

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Deploy to GitHub Pages

This repo includes `.github/workflows/deploy.yml` for automatic deployment.

1. Push this project to GitHub.
2. In GitHub: `Settings -> Pages`, set Source to `GitHub Actions`.
3. Push to `main` (or `master`) to trigger deployment.
4. Your site will be published at:
   - `https://<your-username>.github.io/clusterpairs/`

Note: The Vite production base is currently set to `/clusterpairs/` in `vite.config.ts`.  
If your repository name is different, update that value.
