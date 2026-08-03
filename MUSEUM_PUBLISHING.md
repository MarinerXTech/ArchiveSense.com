# ArchiveSense museum publishing

The public museum at `/museum/` is generated from the private publishing project in the sibling `ArchiveSense_App` repository.

## Update the museum

1. Create a Complete Backup from the Android app and extract it somewhere private. Never place the backup inside this website folder.
2. In `ArchiveSense_App\web`, prepare an explicit selection manifest and run the allowlist publisher described in that folder's README.
3. Preview and inspect the generated public exhibit.
4. Run `npm run test` and then `npm run sync:website` from `ArchiveSense_App\web`.
5. Upload the website folder to GitHub using the normal website publishing process.

The sync command replaces only this website's `museum` folder. Do not edit `museum` directly because the next sync will replace those changes.

## Privacy boundary

The website may contain only the generated public exhibit JSON and sanitized public images. Do not upload Android backup ZIP files, `archive_export.json`, media manifests, selection manifests, prices, sellers, storage locations, private notes, or original images with embedded metadata.
