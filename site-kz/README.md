# Arnion.kz landing

The Russian, Kazakh, and English pages, the team pages, and the contact pages
are in `public/`. Open `public/index.html` directly in a browser for a local
preview. The pages use shared static assets and need no build or runtime.

## Goodhost deployment

For a full migration, deploy the contents of `public/` to the domain's
document root. Keep the directory layout so the language links and the
existing Russian URLs `/contacts/` and `/o-kompanii-arnion/` resolve.

During the WordPress trial, the existing WordPress installation serves its
legacy URLs. The site files live under `/httpdocs/arni-preview/` and a separate
`/httpdocs/index.html` serves the homepage. In that entry file, point the asset,
language, team, and contact links into `/arni-preview/`, and keep the homepage
and section links rooted at `/`. To roll back the trial, move the root
`index.html` out of `httpdocs` in Plesk. Keep WordPress's `index.php` in place.

The legacy `code.arnion.ru` service is built from `site/Dockerfile`. It sends a
temporary redirect to the download section and retains the query string.
